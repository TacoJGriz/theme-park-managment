# Theme Park Management System

A web application designed to manage theme park operations. The app follows an MVC architecture using Node.js, Express, and MySQL.

## Project Structure

The submission includes the following files and directories:

- **`app.js`**: Initializes the Express server, configures session management, and sets up middleware.
- **`db.js`**: Handles the database connection pool.
- **`.env`**: Contains environment variables and database credentials.
- **`routes/`**: Contains backend logic and API endpoints. Examples:
  - `routes/auth.js`: Handles login/logout logic.
  - `routes/rides.js`: Manages ride operations.
- **`views/`**: Contains the frontend templates rendered by EJS.
- **`middleware/`**: Custom middleware functions to enforce role-based access control.
- **`public/`**: Stores images for the front page.
- **`submission_dump.sql`**: Complete SQL export of the database (Schema, stored procedures, triggers, and sample data).
- **`ca.pem`**: Certificate required for SSL connection to the database.

---

## 🚀 Installation & Setup

### 1. Connect to Database
To view park data and verify changes, connect via **MySQL Workbench**:

1. Create a new connection.
2. Enter the following **Connection Details**:

| Setting | Value |
| :--- | :--- |
| **Hostname** | `mysql-254204d6-curaturae-12be.f.aivencloud.com` |
| **Port** | `22523` |
| **Username** | `avnadmin` |
| **Password** | `copy from .env file` |

3. Navigate to the **SSL** tab.
4. In the **"SSL CA File"** field, browse and select the included `ca.pem` file.
5. Click **"Test Connection"**.

### 2. Run the Web App

#### Option A: Hosted Version (No Setup)
Access the live application here: **[https://theme-park-app.onrender.com/](https://theme-park-app.onrender.com/)**
> *Note: Data changes made on the frontend can be verified in the database using the connection established in Step 1.*

#### Option B: Local Setup
1. Unzip the codebase if not already done so.
2. Open a terminal in the root directory.
   - Install dependencies: `npm install`
   - Start the server: `node app.js`
3. **Open your browser to http://localhost:3000**
   > **Note:** The `.env` file is already configured to connect with the database.

---

## Logins & Roles

**Default Password for ALL accounts:** `Clubhouse123`

### Key Role Accounts

| Role | Email |
| :--- | :--- |
| **Admin** | `walt@park.com` |
| **Park Manager** | `minnie@park.com` |
| **Location Manager** (Main Entrance) | `mickey@park.com` |
| **Staff** (Main Entrance) | `daisy@park.com` |

### Maintenance Staff

| Role | Email |
| :--- | :--- |
| Maintenance 1 | `goofy@park.com` |
| Maintenance 2 | `bob@park.com` |
| Maintenance 3 | `felix@park.com` |
| Maintenance 4 | `manny@park.com` |
| Maintenance 5 | `doc@park.com` |

> **Note:** You may also log in as any other employee found in the "Park Employees" list using their email and the default password "Clubhouse123".
