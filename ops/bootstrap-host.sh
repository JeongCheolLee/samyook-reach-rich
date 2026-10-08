#!/usr/bin/env bash
set -euo pipefail
# Run as root on the existing EC2 host. Creates only Reach Rich resources.
id reach-rich >/dev/null 2>&1 || useradd --system --home-dir /var/lib/reach-rich --shell /sbin/nologin reach-rich
install -d -o root -g reach-rich -m 0750 /etc/reach-rich
install -d -o reach-rich -g reach-rich -m 0750 /opt/reach-rich/releases /var/lib/reach-rich
install -d -o root -g root -m 0755 /var/www/reach-rich-acme
python3 - <<'PY'
import pathlib, secrets, subprocess, os, grp, tempfile, shutil
from datetime import datetime, timezone
def sql(statement):
    p=subprocess.run(['runuser','-u','postgres','--','psql','-X','-v','ON_ERROR_STOP=1','-At','-d','postgres'],input=statement,text=True,capture_output=True)
    if p.returncode: raise RuntimeError('Database provisioning failed; inspect PostgreSQL locally')
    return p.stdout.strip()
def configure_local_hba():
    # Put only our loopback rules before generic ident rules; leave all other bytes intact.
    hba=pathlib.Path(sql('SHOW hba_file;')).resolve(strict=True)
    original=hba.read_bytes()
    start=b'# BEGIN REACH RICH LOCAL ACCESS\n'
    end=b'# END REACH RICH LOCAL ACCESS\n'
    databases='reach_rich,reach_rich_rehearsal,reach_rich_restore_test'
    block=start + (
        f'host {databases} reach_rich 127.0.0.1/32 scram-sha-256\n'
        f'host {databases} reach_rich ::1/128 scram-sha-256\n'
    ).encode() + end
    remaining=original
    if start in original or end in original:
        if original.count(start)!=1 or original.count(end)!=1:
            raise RuntimeError('Ambiguous Reach Rich HBA markers; no HBA changes made')
        first=original.index(start)
        last=original.index(end)
        if last<first:
            raise RuntimeError('Invalid Reach Rich HBA marker order; no HBA changes made')
        remaining=original[:first]+original[last+len(end):]
    updated=block+remaining
    if updated==original:
        return
    if sql("SELECT rolpassword LIKE 'SCRAM-SHA-256$%' FROM pg_authid WHERE rolname='reach_rich';")!='t':
        raise RuntimeError('Reach Rich requires a SCRAM password before updating HBA; no HBA changes made')

    stat=hba.stat()
    backup=hba.with_name(hba.name+'.reach-rich-before-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    with open(backup,'xb') as file:
        os.fchmod(file.fileno(),0o600)
        file.write(original)
        file.flush()
        os.fsync(file.fileno())

    def replace(data):
        temporary=None
        try:
            with tempfile.NamedTemporaryFile(dir=hba.parent,prefix='.reach-rich-hba-',delete=False) as file:
                temporary=pathlib.Path(file.name)
                file.write(data)
                file.flush()
                os.fsync(file.fileno())
                os.fchown(file.fileno(),stat.st_uid,stat.st_gid)
            shutil.copystat(hba,temporary)
            os.replace(temporary,hba)
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()

    if hba.read_bytes()!=original:
        raise RuntimeError('HBA changed concurrently; no HBA changes made')
    replace(updated)
    try:
        # This view parses the on-disk file, allowing rejection before a reload.
        if sql('SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;')!='0':
            raise RuntimeError('HBA syntax validation failed')
        if sql('SELECT pg_reload_conf();')!='t':
            raise RuntimeError('PostgreSQL rejected HBA reload signal')
    except Exception:
        if hba.read_bytes()!=updated:
            raise RuntimeError('HBA changed concurrently; restore original from '+str(backup)+' after review')
        replace(original)
        sql('SELECT pg_reload_conf();')
        raise RuntimeError('HBA validation/reload failed; original HBA restored from '+str(backup)) from None
    print('Reach Rich local password rules prepared; original HBA backup: '+str(backup))

env=pathlib.Path('/etc/reach-rich/db.env')
if not env.exists():
    if sql("SELECT 1 FROM pg_roles WHERE rolname='reach_rich';"):
        raise RuntimeError('Existing role without managed credentials; refusing to replace it')
    password=secrets.token_urlsafe(36)
    sql("SET password_encryption = 'scram-sha-256'; CREATE ROLE reach_rich LOGIN CONNECTION LIMIT 12 PASSWORD '"+password+"';")
    fd=os.open(env,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o640)
    with os.fdopen(fd,'w') as f: f.write('DATABASE_URL=postgresql://reach_rich:'+password+'@127.0.0.1:5432/reach_rich\n')
    os.chown(env,0,grp.getgrnam('reach-rich').gr_gid)
    os.chmod(env,0o640)
if not sql("SELECT 1 FROM pg_database WHERE datname='reach_rich';"):
    sql('CREATE DATABASE reach_rich OWNER reach_rich;')
sql("REVOKE CONNECT ON DATABASE reach_rich FROM PUBLIC; GRANT CONNECT ON DATABASE reach_rich TO reach_rich; ALTER DATABASE reach_rich SET timezone TO 'UTC';")
configure_local_hba()
print('Reach Rich user, directories, database and private credentials prepared')
PY
