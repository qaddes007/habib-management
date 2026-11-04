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

The current desktop app still uses PHP and MySQL from XAMPP at `C:\xampp`. A client PC must have XAMPP installed and MySQL started before launching the app. A local app update does not install XAMPP or synchronize another PC's database: each PC currently has its own local database. Use a separate, secure database-hosting setup if both PCs must share live records.

The packaged desktop app creates a per-user API token and requires it for local API requests. API origins are restricted to the desktop app and the localhost development ports. The development server does not require the desktop token.

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
