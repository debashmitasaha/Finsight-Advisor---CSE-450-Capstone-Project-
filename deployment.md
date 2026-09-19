Without a domain, the main change is HTTPS.

You have two choices:

1. **Recommended:** use Azure’s free DNS name like `finsight-app.eastus.cloudapp.azure.com`, then you can still use real HTTPS with Certbot.
2. **Simpler:** use only the VM public IP like `http://20.x.x.x`, but HTTPS will not work cleanly with Let’s Encrypt.

I recommend option 1.

**Deployment With Azure Free DNS + HTTPS**
**1. Create Azure DNS Name For The VM**

In Azure Portal:

1. Go to your VM.
2. Open **Overview**.
3. Click your **Public IP address**.
4. Open **Configuration**.
5. Find **DNS name label**.
6. Set something like:

```txt
finsight-app
```

Azure will give you a URL like:

```txt
finsight-app.eastus.cloudapp.azure.com
```

Use your actual region. I’ll call it:

```txt
YOUR_AZURE_DNS
```

Example:

```txt
finsight-app.eastus.cloudapp.azure.com
```

**2. Open Azure VM Ports**

In Azure Network Security Group, allow inbound:

```txt
22   SSH
80   HTTP
443  HTTPS
```

**3. SSH Into VM**

```bash
ssh seed@YOUR_VM_PUBLIC_IP
```

**4. Install Packages**

No local PostgreSQL server needed because you use Supabase.

```bash
sudo apt update
sudo apt upgrade -y

sudo apt install -y nginx git curl python3-pip postgresql-client ufw certbot python3-certbot-nginx software-properties-common build-essential
```

Install Node.js:

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
```

Install Python 3.11 for the backend. The backend requirements include packages such as `pandas==3.0.1`, which require Python 3.11 or newer.

On Ubuntu 24.04, the default `python3` is already new enough. On Ubuntu 22.04, install Python 3.11:

```bash
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3.11-dev
```

**5. Configure Firewall**

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

**6. Clone Project**

```bash
cd /var/www
sudo git clone YOUR_REPO_URL finsight
sudo chown -R $USER:$USER /var/www/finsight
cd /var/www/finsight
```

**7. Configure Backend With Supabase**

```bash
cd /var/www/finsight/backend
cp .env.example .env
nano .env
```

Use your Supabase connection string:

```env
DATABASE_URL=postgresql://postgres.xxxxx:YOUR_SUPABASE_PASSWORD@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require

SECRET_KEY=CHANGE_THIS_TO_A_LONG_RANDOM_SECRET
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=0.5

ENV=production
DEBUG=False
HOST=127.0.0.1
PORT=8000

CORS_ORIGINS=https://finsight-advisor.eastasia.cloudapp.azure.com

AUTO_SEED_DEMO=False
LOG_LEVEL=INFO
```

Generate `SECRET_KEY`:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

If your Supabase password has special characters like `@`, `#`, `%`, encode them or use the exact URI Supabase gives you.

**8. Apply Database Schema To Supabase**

If Supabase does not already have your tables:

```bash
cd /var/www/finsight/backend
psql "YOUR_SUPABASE_DATABASE_URL" < schema.sql
```

Use the same Supabase URI from `.env`.

**9. Install Backend Dependencies**

```bash
cd /var/www/finsight/backend
python3.11 -m venv venv
source venv/bin/activate
python --version
pip install --upgrade pip
pip install -r requirements.txt
```

Test backend:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another SSH session:

```bash
curl http://127.0.0.1:8000/health
```

Stop test server with `Ctrl+C`.

**10. Create Backend Service**

```bash
sudo nano /etc/systemd/system/finsight-backend.service
```

Paste:

```ini
[Unit]
Description=FinSight FastAPI Backend
After=network.target

[Service]
User=seed
Group=www-data
WorkingDirectory=/var/www/finsight/backend
EnvironmentFile=/var/www/finsight/backend/.env
Environment="PATH=/var/www/finsight/backend/venv/bin"
ExecStart=/var/www/finsight/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

Use the same Linux user that owns `/var/www/finsight`. In this VM, that user is `seed`.

Start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable finsight-backend
sudo systemctl start finsight-backend
sudo systemctl status finsight-backend
```

**11. Build Frontend**

```bash
cd /var/www/finsight/frontend
npm install
VITE_API_BASE_URL=https://YOUR_AZURE_DNS npm run build
```

Example:

```bash
VITE_API_BASE_URL=https://finsight-app.eastus.cloudapp.azure.com npm run build
```

**12. Configure Nginx**

```bash
sudo nano /etc/nginx/sites-available/finsight
```

Paste:

```nginx
server {
    listen 80;
    server_name YOUR_AZURE_DNS;

    root /var/www/finsight/frontend/dist;
    index index.html;

    client_max_body_size 50M;

    location /auth/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /admin/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /transactions/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /grouping/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /categorization/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /budget/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /forensic-engine/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /forensic/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/finsight /etc/nginx/sites-enabled/finsight
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Test HTTP first:

```bash
curl http://YOUR_AZURE_DNS/health
```

**13. Enable HTTPS**

Now Certbot can work because Azure gave you a real DNS hostname.

```bash
sudo certbot --nginx -d YOUR_AZURE_DNS
```

Choose redirect HTTP to HTTPS.

Test:

```bash
curl https://YOUR_AZURE_DNS/health
```

Open in browser:

```txt
https://YOUR_AZURE_DNS
https://YOUR_AZURE_DNS/api/docs
```

**If You Use Only Public IP Instead**

Then use:

```txt
http://YOUR_VM_PUBLIC_IP
```

Frontend build:

```bash
VITE_API_BASE_URL=http://YOUR_VM_PUBLIC_IP npm run build
```

Nginx:

```nginx
server_name _;
```

But HTTPS with Let’s Encrypt will not work properly on a raw IP address. For HTTPS, use either a real domain or Azure’s free `cloudapp.azure.com` DNS label.
