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

## Production build

```bash
cd frontend
npm run build
```

Serve the `frontend/dist` folder with any static host, and point `/api` to your PHP server (Apache/Nginx + PHP-FPM).

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
