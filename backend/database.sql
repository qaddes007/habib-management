-- ============================================================
-- S. HABIB STEEL & LASER CRAFT - Management System
-- MySQL Database Schema
-- ============================================================

CREATE DATABASE IF NOT EXISTS habib_management CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE habib_management;

-- Company settings (single row)
CREATE TABLE IF NOT EXISTS company (
    id INT PRIMARY KEY DEFAULT 1,
    name VARCHAR(255) NOT NULL DEFAULT 'S. HABIB STEEL & LASER CRAFT',
    tagline TEXT,
    phones VARCHAR(255),
    email VARCHAR(255),
    address TEXT,
    tiktok VARCHAR(100),
    developed_by VARCHAR(255),
    pay_account_name VARCHAR(255),
    pay_account_1 VARCHAR(100),
    pay_account_1_display VARCHAR(150),
    pay_label VARCHAR(100),
    pay_bank VARCHAR(100),
    next_sr_no INT DEFAULT 1001
);

INSERT INTO company (id, name, tagline, phones, email, address, tiktok, developed_by,
    pay_account_name, pay_account_1, pay_account_1_display, pay_label, pay_bank, next_sr_no)
VALUES (
    1,
    'S. HABIB STEEL & LASER CRAFT',
    'WE DEAL IN : HRC , CRC, GP ,GI, STAINLESS STEEL SHEETS,&ALSO LASER CUTTING',
    '',
    '',
    '',
    's.habib.steel.las',
    '',
    '',
    '',
    '',
    '',
    '',
    1003
) ON DUPLICATE KEY UPDATE id=id;

-- Bills / Orders
CREATE TABLE IF NOT EXISTS bills (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sr_no INT NOT NULL UNIQUE,
    client_name VARCHAR(255) NOT NULL,
    client_phone VARCHAR(50),
    grand_total DECIMAL(12,2) DEFAULT 0,
    discount DECIMAL(12,2) DEFAULT 0,
    net_total DECIMAL(12,2) DEFAULT 0,
    paid_amount DECIMAL(12,2) DEFAULT 0,
    remaining_balance DECIMAL(12,2) DEFAULT 0,
    payment_status ENUM('PAID','PARTIAL','UNPAID') DEFAULT 'UNPAID',
    personal_total DECIMAL(12,2) DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_date (created_at),
    INDEX idx_client (client_name),
    INDEX idx_status (payment_status)
);

-- Frames / Items inside a bill
CREATE TABLE IF NOT EXISTS bill_frames (
    id INT AUTO_INCREMENT PRIMARY KEY,
    bill_id INT NOT NULL,
    serial INT DEFAULT 1,
    bill_category ENUM('cnc_only','cnc_pipe','fancy','pipe_grill','bending_sheet','bending_only') DEFAULT 'cnc_only',
    material VARCHAR(100),
    pipe_material VARCHAR(100),
    cnc_material VARCHAR(100),
    gauge VARCHAR(50),
    pipe_gauge VARCHAR(50),
    cnc_gauge VARCHAR(50),
    pcs INT DEFAULT 1,
    width DECIMAL(10,3) DEFAULT 0,
    length DECIMAL(10,3) DEFAULT 0,
    rate DECIMAL(12,2) DEFAULT 0,
    direct_price DECIMAL(12,2) DEFAULT 0,
    area DECIMAL(12,3) DEFAULT 0,
    total DECIMAL(12,2) DEFAULT 0,
    extra_item_name VARCHAR(255),
    extra_item_price DECIMAL(12,2) DEFAULT 0,
    sheet_size VARCHAR(20) DEFAULT '4x8',
    tags JSON,
    color_yes TINYINT(1) DEFAULT 0,
    color_no TINYINT(1) DEFAULT 0,
    fitting_yes TINYINT(1) DEFAULT 0,
    fitting_no TINYINT(1) DEFAULT 0,
    pipe_tag_gauge VARCHAR(50),
    pipe_tag_size VARCHAR(50),
    gola_tag_gauge VARCHAR(50),
    gola_tag_size VARCHAR(50),
    master_tag_gauge VARCHAR(50),
    master_tag_size VARCHAR(50),
    FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
    INDEX idx_bill (bill_id)
);

-- Payment history
CREATE TABLE IF NOT EXISTS payment_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    bill_id INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    note VARCHAR(255),
    paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
);

-- Personal expenses attached to a bill (client-side personal costs)
CREATE TABLE IF NOT EXISTS bill_personal_expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    bill_id INT NOT NULL,
    description VARCHAR(255),
    cost DECIMAL(12,2) DEFAULT 0,
    FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
);

-- Business daily expenses
CREATE TABLE IF NOT EXISTS expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    category VARCHAR(100) DEFAULT 'General',
    expense_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_date (expense_date)
);

-- Global personal expenses (not tied to a bill)
CREATE TABLE IF NOT EXISTS personal_expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    expense_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_date (expense_date)
);

-- Sheet Stock
CREATE TABLE IF NOT EXISTS sheet_stock (
    id INT AUTO_INCREMENT PRIMARY KEY,
    material VARCHAR(100) NOT NULL,          -- MS-CNC, SS-CNC, SG-CNC, GP
    gauge VARCHAR(50) NOT NULL,               -- e.g. 12 Gauge
    sheet_size VARCHAR(20) NOT NULL,          -- 4x8, 5x8, 4x10, 5x10
    quantity DECIMAL(10,2) DEFAULT 0,         -- number of sheets
    kg_per_sheet DECIMAL(10,2) DEFAULT 0,
    notes TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_stock (material, gauge, sheet_size)
);

-- Stock movement log (for audit)
CREATE TABLE IF NOT EXISTS stock_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stock_id INT,
    bill_id INT NULL,
    change_qty DECIMAL(10,2) NOT NULL,       -- negative = consumed, positive = added/refund
    reason VARCHAR(255),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sample stock data (same names as bills: MS-CNC, SS-CNC, SG-CNC, GP)
INSERT INTO sheet_stock (material, gauge, sheet_size, quantity, kg_per_sheet) VALUES
('MS-CNC', '12 Gauge', '4x8', 50, 45.0),
('MS-CNC', '14 Gauge', '4x8', 40, 38.0),
('MS-CNC', '16 Gauge', '4x8', 30, 30.0),
('SS-CNC', '12 Gauge', '4x8', 20, 42.0),
('SS-CNC', '14 Gauge', '4x8', 15, 35.0),
('SG-CNC', '12 Gauge', '4x8', 10, 42.0)
ON DUPLICATE KEY UPDATE quantity=VALUES(quantity);
