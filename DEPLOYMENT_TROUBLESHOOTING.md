# Deployment Troubleshooting Notes

These are the issues we ran into while deploying FinSight on the Azure VM, plus the fixes that worked.

## 1. Permission Denied When Cloning Into `/var/www`

**Problem**

```bash
fatal: could not create work tree dir 'Finsight-Advisor---CSE-450-Capstone-Project-': Permission denied
```

**Cause**

`/var/www` is owned by `root`, so the normal VM user cannot create folders there.

**Fix**

Clone with `sudo`, then give ownership of the project folder back to the VM user:

```bash
cd /var/www
sudo git clone https://github.com/debashmitasaha/Finsight-Advisor---CSE-450-Capstone-Project-.git finsight
sudo chown -R $USER:$USER /var/www/finsight
cd /var/www/finsight
```

## 2. Git Dubious Ownership Error

**Problem**

```bash
fatal: detected dubious ownership in repository at '/var/www/finsight'
```

**Cause**

The repository was created or modified as `root`, but Git was being run as the normal user.

**Fix**

Change ownership of the project directory:

```bash
sudo chown -R $USER:$USER /var/www/finsight
```

Avoid using Git's `safe.directory` workaround unless the folder really must stay owned by another user.

## 3. Markdown Links Pasted Into Terminal

**Problem**

Commands were pasted with Markdown link syntax, such as:

```bash
curl [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)
```

This can make commands hang or behave incorrectly.

**Fix**

Use the raw URL only:

```bash
curl http://127.0.0.1:8000/health
curl http://finsight-advisor.eastasia.cloudapp.azure.com/health
```

The same applies to Git remotes:

```bash
git remote add origin https://github.com/debashmitasaha/Finsight-Advisor---CSE-450-Capstone-Project-.git
```

## 4. Wrong CORS Format

**Problem**

The CORS value was written like a Markdown link:

```env
CORS_ORIGINS=[https://finsight-advisor.eastasia.cloudapp.azure.com](https://finsight-advisor.eastasia.cloudapp.azure.com)
```

**Cause**

The backend reads `CORS_ORIGINS` as plain comma-separated URLs.

**Fix**

Use the raw origin:

```env
CORS_ORIGINS=https://finsight-advisor.eastasia.cloudapp.azure.com
```

For multiple origins:

```env
CORS_ORIGINS=https://finsight-advisor.eastasia.cloudapp.azure.com,http://localhost:5173
```

Restart the backend after changing `backend/.env`.

## 5. FastAPI Version Not Found

**Problem**

```bash
ERROR: Could not find a version that satisfies the requirement fastapi==0.135.1
```

**Cause**

The VM was using an older Python version. Newer FastAPI versions require Python 3.10 or newer.

**Fix**

Upgrade the VM to a newer Ubuntu release and use a newer Python version. For this project, Python 3.11 is recommended because other dependencies need it too.

Check Python:

```bash
python --version
```

Create the backend virtual environment with Python 3.11:

```bash
cd /var/www/finsight/backend
python3.11 -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

## 6. `python3.10` Package Not Found On Ubuntu 20.04

**Problem**

```bash
E: Unable to locate package python3.10
E: Unable to locate package python3.10-venv
E: Unable to locate package python3.10-dev
```

**Cause**

The VM was on Ubuntu 20.04, and the required Python packages were not available from the configured apt repositories.

**Fix**

Upgrade the VM to Ubuntu 22.04 or 24.04.

Use Ubuntu's release upgrader:

```bash
sudo apt update
sudo apt dist-upgrade -y
sudo apt autoremove -y
sudo reboot
```

After reconnecting:

```bash
sudo apt install -y update-manager-core
sudo nano /etc/update-manager/release-upgrades
```

Set:

```text
Prompt=lts
```

Then run:

```bash
sudo do-release-upgrade
```

Upgrade sequentially. For example, go from Ubuntu 20.04 to 22.04 first, not directly to 24.04.

## 7. Ubuntu Upgrade Over SSH Warning

**Problem**

During `do-release-upgrade`, Ubuntu warned that the upgrade was running over SSH and offered to start another SSH daemon on port `1022`.

**Fix**

Continue, but temporarily allow port `1022` in the Azure Network Security Group so recovery is possible if the main SSH connection drops.

Recovery SSH command:

```bash
ssh -p 1022 seed@finsight-advisor.eastasia.cloudapp.azure.com
```

After the upgrade is complete and the VM is stable, remove the temporary port `1022` rule from Azure.

## 8. Config File Prompts During Ubuntu Upgrade

**Problem**

The upgrade asked what to do with modified files such as:

```text
/etc/systemd/resolved.conf
/etc/chrony/chrony.conf
```

**Fix**

Keep the local version currently installed.

For prompts like:

```text
Y or I: install maintainer's version
N or O: keep current version
```

Choose:

```text
N
```

This is safer for Azure VM networking and time-sync settings.

## 9. Docker Daemon Restart Prompt

**Problem**

The upgrade asked:

```text
Automatically restart Docker daemon?
```

**Fix**

Choose:

```text
Yes
```

Docker may restart and stop running containers, but this is expected during a system upgrade.

## 10. Obsolete Packages After Ubuntu Upgrade

**Problem**

The release upgrade asked:

```text
Remove obsolete packages?
```

**Fix**

Choose:

```text
Yes
```

This removes old packages from the previous Ubuntu release.

## 11. Pandas Requires Python 3.11

**Problem**

```bash
ERROR: Could not find a version that satisfies the requirement pandas==3.0.1
```

The output also said:

```text
pandas 3.0.1 Requires-Python >=3.11
```

**Cause**

The virtual environment was using Python 3.10, but `pandas==3.0.1` requires Python 3.11 or newer.

**Fix**

Install Python 3.11 and recreate the virtual environment:

```bash
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3.11-dev build-essential

cd /var/www/finsight/backend
deactivate 2>/dev/null || true
mv venv venv-old

python3.11 -m venv venv
source venv/bin/activate
python --version
python -m pip install --upgrade pip
pip install -r requirements.txt
```

## 12. Backend Service User Was Wrong

**Problem**

The deployment guide originally used:

```ini
User=azureuser
```

But the VM user was:

```text
seed
```

**Fix**

Use the same Linux user that owns `/var/www/finsight`:

```ini
[Service]
User=seed
Group=www-data
WorkingDirectory=/var/www/finsight/backend
EnvironmentFile=/var/www/finsight/backend/.env
Environment="PATH=/var/www/finsight/backend/venv/bin"
ExecStart=/var/www/finsight/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
```

Then reload and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable finsight-backend
sudo systemctl start finsight-backend
sudo systemctl status finsight-backend
```

## 13. Backend Was Off While Testing `/health`

**Problem**

The public `/health` route was tested while the backend service was stopped.

**Cause**

Nginx proxies `/health` to FastAPI:

```text
http://127.0.0.1:8000/health
```

So the FastAPI service must be running.

**Fix**

Start the backend service:

```bash
sudo systemctl start finsight-backend
sudo systemctl status finsight-backend
```

Test in order:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1/health
curl http://finsight-advisor.eastasia.cloudapp.azure.com/health
```

Expected result:

```json
{"status":"ok"}
```

## 14. Azure NSG Priority Conflict

**Problem**

Azure said the rule priority had to be unique.

**Cause**

Network Security Group rule priorities must be unique in the same NSG.

**Fix**

Use any unused priority between `100` and `4096`.

Example:

```text
HTTP  port 80   priority 320
HTTPS port 443  priority 330
```

The temporary SSH recovery rule on port `1022` can use a different priority, such as `310`.

## 15. Public HTTP Health Check Working

**Successful Check**

```bash
curl -v http://finsight-advisor.eastasia.cloudapp.azure.com/health
```

Successful response:

```text
HTTP/1.1 200 OK
```

```json
{"status":"ok"}
```

This confirms:

- DNS works.
- Azure port 80 is open.
- Nginx is running.
- The FastAPI backend service is running.
- Nginx can proxy to FastAPI.

## 16. Certbot Could Not Install Certificate

**Problem**

```text
Could not automatically find a matching server block for finsight-advisor.eastasia.cloudapp.azure.com.
Set the `server_name` directive to use the Nginx installer.
```

**Cause**

The Nginx site did not have a matching `server_name`.

**Fix**

Edit the Nginx site:

```bash
sudo nano /etc/nginx/sites-available/finsight
```

Set:

```nginx
server_name finsight-advisor.eastasia.cloudapp.azure.com;
```

Then test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Install the existing certificate:

```bash
sudo certbot install --cert-name finsight-advisor.eastasia.cloudapp.azure.com
```

Then test HTTPS:

```bash
curl -v https://finsight-advisor.eastasia.cloudapp.azure.com/health
```

## 17. Certbot Domain Typo

**Problem**

The Certbot command was accidentally run with a malformed domain:

```bash
sudo certbot --nginx -d finsight-advisor.eastasia.cloudapp.azure.comudapp.azure.com
```

**Fix**

Use the correct domain:

```bash
sudo certbot --nginx -d finsight-advisor.eastasia.cloudapp.azure.com
```

## 18. Frontend API URL Build Variable

**Question**

Why use `VITE_API_BASE_URL` in the terminal?

**Answer**

Vite reads frontend environment variables at build time. A terminal variable works as a one-time build override:

```bash
VITE_API_BASE_URL=https://finsight-advisor.eastasia.cloudapp.azure.com npm run build
```

It can also be stored in a frontend env file:

```bash
nano /var/www/finsight/frontend/.env.production
```

Add:

```env
VITE_API_BASE_URL=https://finsight-advisor.eastasia.cloudapp.azure.com
```

Then build normally:

```bash
cd /var/www/finsight/frontend
npm run build
```

After changing frontend env values, rebuild the frontend. Static files in `dist/` do not update automatically.

