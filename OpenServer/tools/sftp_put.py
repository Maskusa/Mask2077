import sys, paramiko, os
host=sys.argv[1]; user=sys.argv[2]; pw=sys.argv[3]; src=sys.argv[4]; dst=sys.argv[5]
ssh=paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(host, username=user, password=pw, timeout=30)
s=ssh.open_sftp()
s.put(src, dst)
try:
    s.chmod(dst, 0o755)
except Exception:
    pass
s.close(); ssh.close()

