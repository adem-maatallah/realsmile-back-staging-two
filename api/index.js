const express = require("express");
const cls = require("cls-hooked");

const path = require("path");
require("dotenv").config();
const db = require("../config"); // Import the db after initialization
const PORT = process.env.PORT || 5001;
const app = express();
// Simple manual logger
app.use((req, res, next) => {
  const now = new Date().toISOString()
  console.log(`[${now}] ${req.method} ${req.originalUrl}`)
  next()
})
const cors = require("cors");
const bodyParser = require("body-parser");
const { NotFoundError } = require("../middlewares/apiError");
const authSession = require("express-session");
const mysqlStore = require("express-mysql-session")(authSession);
const globalErrorHandler = require("../middlewares/globalErrorHandler");
const { patientAuth, doctorAuth } = require("../utils/firebaseConfig");
const sessionStoreOptions = {
  password: process.env.DB_PASS,
  user: process.env.DB_USER,
  database: process.env.MYSQL_DB,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  createDatabaseTable: true,
};

// 1) create the namespace
const ns = cls.createNamespace('request-session');

// 2) wrap every request in ns.run and bind its emitters
app.use((req, res, next) => {
  ns.run(() => {
    ns.bindEmitter(req);
    ns.bindEmitter(res);
    next();
  });
});
const sessionStore = new mysqlStore(sessionStoreOptions);

app.use(
  authSession({
    name: 'realsmile.session',
    secret: process.env.SESS_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    rolling: true,                // ← add this so every response resets the cookie’s expiry
    cookie: {
      secure: process.env.NODE_ENV === 'production', 
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      httpOnly: true,
      maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
      domain:
        process.env.NODE_ENV === 'production'
          ? '.realsmile.app'
          : undefined,
    },
  })
);

app.use(express.json());
app.use(
  bodyParser.urlencoded({
    extended: false,
  })
);
app.use(
  cors({
    origin: function (origin, callback) {
      const allowedOrigins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5013",
        "http://127.0.0.1:5013",
        "https://devapi.realsmile.app",
        "https://realsmile.app",
        "https://beta.realsmile.app",
        "http://10.0.2.2:3000", // Android emulator
      ];
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    optionsSuccessStatus: 200, 
    credentials: true,
  })
);
app.use(bodyParser.json({ limit: "5mb" }));
app.use(express.static(path.resolve("templates")));
app.use(express.static(path.resolve("assets")));

const routes = require("../routes/v1/index");
const { ensureBucketExists } = require("../utils/googleCDN");
const { getAuth } = require("firebase-admin/auth");
const compression = require("compression");
const helmet = require("helmet");

app.use(compression());
app.use(helmet());

app.set("trust proxy", 2);

// Set up rate limiter: maximum of twenty requests per minute
const RateLimit = require("express-rate-limit");
const limiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200,
});
// Apply rate limiter to all requests
app.use(limiter);
app.get("/current-time", (req, res) => {
  try {
    let currentTime = new Date();

    // Read daysToAdd from query parameters and parse it as an integer
    const daysToAdd = parseInt(0);

    // Add days to the current date
    currentTime.setDate(currentTime.getDate() + daysToAdd);

    // Convert to ISO string for consistency
    const currentTimeISO = currentTime.toISOString();

    console.log(
      `Current server time (adjusted by ${daysToAdd} days):`,
      currentTimeISO
    );
    res.status(200).json({ currentTime: currentTimeISO });
  } catch (error) {
    console.error("Error fetching current time:", error);
    res.status(500).json({ error: "Failed to fetch current time" });
  }
});
app.disable("x-powered-by");

// Mount v1 and v2 routes on separate URL namespaces.
const v1Routes = require("../routes/v1/index"); // uses JWT auth
app.use("/api/v1", v1Routes);

const v2Routes = require("../routes/v1/index"); // uses session auth
app.use("/api/v2", v2Routes);

app.all("*", (req, res, next) => next(new NotFoundError()));

app.use(globalErrorHandler);

// Optional: Firebase Admin
exports.patientAuth = patientAuth;
exports.doctorAuth = doctorAuth;

// Ensure Firestore is initialized and any other asynchronous setup before starting the server
(async () => {
  try {
    await ensureBucketExists(process.env.GOOGLE_STORAGE_BUCKET_NAME);
    console.log(`Firestore initialized successfully`);

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`App running succesfully on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to initialize Firestore or other services:", error);
    process.exit(1); // Exit the process with failure
  }
})();

module.exports = app;
