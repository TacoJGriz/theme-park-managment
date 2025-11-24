## Project Structure
This application follows a standard MVC architecture using Node.js, Express, and MySQL.

* **`app.js`**: The main entry point of the application. It initializes the Express server, configures session management, and sets up the middleware.
* **`db.js`**: Handles the database connection pool using `mysql2`, ensuring efficient connections to the backend MySQL server.
* **`routes/`**: Contains the backend logic and API endpoints (The "Controllers").
    * _Example:_ `routes/auth.js` handles login/logout logic, while `routes/rides.js` manages ride operations.
* **`views/`**: Contains the frontend templates rendered by EJS (The "Views").
    * Includes reusable components in `views/partials/` (headers/footers) to ensure a consistent UI.
* **`middleware/`**: Contains custom middleware functions.
    * `auth.js`: Enforces Role-Based Access Control (RBAC) to protect routes based on user types (e.g., Admin vs. Guest).
* **`public/`**: Stores static assets accessible to the browser, such as CSS files, client-side JavaScript, and images.

* ## Key Submission Files
* **`submission_dump.sql`**: A complete SQL export of the database. Includes the schema, stored procedures, triggers, and populated sample data required to run the application.
* **`.env`**: A template file listing the required environment variables (DB credentials, session secrets) needed to configure the application locally.
