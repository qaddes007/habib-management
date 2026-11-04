# S. HABIB STEEL & LASER CRAFT — React + PHP + MySQL

Exact feature copy of the original desktop management system.

**Frontend:** React 18 (Vite)  
**Backend:** PHP 8 + MySQL  
**Theme:** Dark navy + orange/gold (same as original)

---

## Features

| Module | Features |
|--------|----------|
| **Dashboard** | Live stats, recent bills, category & material breakdown |
| **New Bill** | Multi-frame, 4 categories (CNC Only, CNC+Pipe, Fancy, Pipe Grill), live totals |
| **Bills** | Search, filter by status, view, delete, add payments |
| **Bill Print** | Printable invoice with company + bank IBAN |
| **Sheet Stock** | Track by material/gauge/size, auto-deduct on CNC bills |
| **Expenses** | Business + Personal |
| **Reports** | Daily / Weekly / Monthly / All-time + profit |

---

## Setup

### 1. Database
```bash
mysql -u root -p < backend/database.sql
```

### 2. Configure PHP
Edit `backend/config/database.php`:
```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'habib_management');
define('DB_USER', 'root');
define('DB_PASS', 'your_password');
```

### 3. Start PHP API (port 8080)
```bash
cd backend
php -S localhost:8080 router.php
```

### 4. Start React frontend (port 5173)
```bash
cd frontend
npm install
npm run dev
```

Open: **http://localhost:5173**

Vite proxies `/api/*` → `http://localhost:8080`.

---

## Windows installer and automatic updates

```bash
cd frontend
npm run build
cd ..
npm install
npx electron-builder --win nsis
```

The public GitHub repository is `qaddes007/habib-management`. Every push to `main` builds a Windows x64 installer and publishes a GitHub Release. Installed copies check for updates automatically and prompt to restart when an update is ready.

To send the app to a client:

1. Open the repository's **Releases** page and download the latest `S. HABIB STEEL & LASER CRAFT Setup ... .exe`.
2. Send that installer to the client and install it on their PC.
3. Future code changes published to `main` are delivered through the app's updater; the client needs an internet connection and should accept the restart prompt.

### Existing runtime requirement

By default, each desktop app uses its own local XAMPP MySQL database. To share the partner's database between trusted computers without buying hosting, the partner's laptop can act as the host over a private Tailscale network. The host laptop must stay on, connected to the internet, and running the app. This option is for trusted staff: anyone given the shared API token can view and change business records.

### Optional private Tailscale connection

This setup shares the partner's existing database; it does not merge another computer's local database. Make a separate backup of both databases first. Decide which database is the master before connecting any client, and do not import the client's database over the partner's database.

1. Install Tailscale on the partner's host laptop and each trusted client computer. Sign each device into the same private tailnet. Do not enable Tailscale Funnel, public port forwarding, or direct public MySQL access.
2. On the host laptop, start XAMPP MySQL and the desktop app. Keep this laptop awake and online while others use the shared database.
3. Open PowerShell on the host and run `tailscale serve --bg 8080`, then run `tailscale serve status` to see the private HTTPS address, such as `https://partner-device.example-tailnet.ts.net`. Follow Tailscale's prompt to enable HTTPS certificates if shown. Do not use `tailscale funnel`.
4. On the host, copy the contents of `%APPDATA%\s-habib-steel-desktop\api-token` securely. This token gives full access to the business data; share it only with trusted staff using a private method, never in a public chat or repository.
5. On each client, make sure the application update with remote-server support is installed, then create `%APPDATA%\s-habib-steel-desktop\remote-server.json` with this content, replacing both example values:

   ```json
   {
     "url": "https://partner-device.example-tailnet.ts.net",
     "token": "paste-the-host-api-token-here"
   }
   ```

6. Restart the client app. XAMPP's PHP is still needed locally to show the interface, but remote mode does not start the client's local MySQL. Bills, payments, stock, and reports go to the partner's shared server. A client computer's existing local database is left untouched and is not automatically merged.
7. To stop sharing, close the host app or run `tailscale serve --https=443 off` on the host. Remove `remote-server.json` from a client to return that app to its own local database.

The local API continues listening only on `127.0.0.1`; Tailscale Serve provides the private HTTPS path. The app requires a root HTTPS `*.ts.net` URL and a 64-character API token for remote mode. The packaged desktop app creates a per-user API token for local requests.

### Company and payment settings

The public source intentionally leaves phone, address, email, developer, and bank account fields blank in the sample SQL. Existing company rows are preserved by the schema import. To configure a new installation, set the `company` row in its local database before issuing bills.

For CI publishing, GitHub Actions needs **Read and write permissions** for repository contents. The workflow uses GitHub's built-in token; no personal access token is stored in the repository.

---

## Folder structure

```
habib_react/
├── backend/
│   ├── api/
│   │   ├── bills.php
│   │   ├── stock.php
│   │   ├── expenses.php
│   │   └── reports.php
│   ├── config/
│   │   └── database.php
│   ├── database.sql
│   └── router.php          # for PHP built-in server
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── api/client.js
│       ├── pages/
│       │   ├── Dashboard.jsx
│       │   ├── NewBill.jsx
│       │   ├── Bills.jsx
│       │   ├── BillView.jsx
│       │   ├── Stock.jsx
│       │   ├── Expenses.jsx
│       │   └── Reports.jsx
│       └── styles/index.css
└── README.md
```

---

**S. HABIB STEEL & LASER CRAFT — Quetta**  
Original desktop app by ENGR. Usama Rehman
