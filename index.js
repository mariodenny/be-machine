const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const http = require("http");
const NodeCache = require("node-cache");
const compression = require("compression");
const { setupWebSocketServer } = require("./config/websocketServer");
const listEndpoints = require('express-list-endpoints');
const path = require("path")

require("dotenv").config();
console.log("GOOGLE_PRIVATE_KEY typeof:", typeof process.env.GOOGLE_PRIVATE_KEY);

const WebSocket = require("ws");
const routeUser = require("./routes/routeAuth");
const routePeminjaman = require("./routes/routeUser");
const routeAdmin = require("./routes/routeAdmin");
const routeSensor = require("./routes/routeSensor");
const routeNotification = require("./routes/routeNotification");
const routeStatus = require('./routes/routeStatus');
const routeMachine = require('./routes/routeMachine')
const routeRental = require('./routes/routeRental')
// Route V2 versi baru untuk satisfy kebutuhan user
const routeNotificationV2 = require('./routes/V2/routeNotification')
const routeSensorV2 = require('./routes/V2/routeSensor')
const routeCountV2 = require('./routes/V2/routeCount')
const testRoutes = require('./routes/routeTest')
// panggil mqtt worker
require("./controllers/V2/mqttWorker")

const rentalMonitor = require('./service/rental-monitor-service')

const connectDb = require("./config/db");

const sensorController = require("./controllers/sensorController");

const { initializeWebSocket } = require("./controllers/sensorController");
const { updateExpiredPeminjaman } = require("./controllers/userController");
const { getAndUpdateCounts } = require("./controllers/countController");

const app = express();
console.log(listEndpoints(app));

const server = http.createServer(app);

const admin = require('firebase-admin');

// update from this
admin.initializeApp({
  credential: admin.credential.cert({
    type: 'service_account',
    project_id: process.env.PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
    universe_domain: 'googleapis.com'
  }),
});


console.log("Firebase admin initialized successfully.");

// Cache setup
const cache = new NodeCache({ stdTTL: 100 });

// Enable compression for faster response
app.use(compression());

app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "./uploads")));

// Connect to database
connectDb();

// Initialize WebSocket
// console.log("Setting up WebSocket server...");
const wss = setupWebSocketServer(server);
sensorController.initializeWebSocket(wss);
// console.log("WebSocket server setup complete");

app.get("/", (req, res) => {
  res.send("API Ready");
});

app.use("/admin", routeAdmin);
app.use("/auth", routeUser);
app.use("/user", routePeminjaman);
app.use("/sensor", routeSensor);
app.use("/status", routeStatus);
app.use("/notifications", routeNotification);
app.use("/api", routeMachine)
app.use("/api", routeRental)
// Register ke route v2
app.use("/api/V2", routeNotificationV2)
app.use("/api/v2", routeSensorV2)
app.use("/api/v2/count", routeCountV2);

// test routes
app.use("/api/", testRoutes)

rentalMonitor.startMonitoring();

const port = process.env.PORT || 5000;

// Start server
server.listen(port, async () => {
  console.log(`Server berjalan di port ${port}`);
  try {
    // Perbarui data expired peminjaman dan count saat startup
    // await updateExpiredPeminjaman();
    // await getAndUpdateCounts();
    // console.log("Initial update of expired peminjaman and counts completed");

    // Schedule task to update peminjaman and counts every 5 minutes
    // scheduleUpdateExpiredPeminjaman();
  } catch (error) {
    console.error("Error during startup:", error);
  }
});

// Fungsi untuk menjalankan pembaruan secara berkala setiap 5 menit
const scheduleUpdateExpiredPeminjaman = () => {
  cron.schedule("*/5 * * * *", async () => {
    // console.log("Menjalankan pemeriksaan peminjaman kedaluwarsa...");
    try {
      // await updateExpiredPeminjaman();
      // await getAndUpdateCounts();
      // console.log(
      //   "Pemeriksaan peminjaman kedaluwarsa dan update counts selesai"
      // );
    } catch (error) {
      console.error("Error during scheduled update:", error);
    }
  });
};

// ------------------------------------------------------------------------------------------------------------ //

// require("dotenv").config();

// const express = require("express");
// const cors = require("cors");
// const cron = require("node-cron");
// const http = require("http");
// const NodeCache = require("node-cache");
// const compression = require("compression");
// const { setupWebSocketServer } = require("./config/websocketServer");

// const WebSocket = require("ws");
// const routeUser = require("./routes/routeAuth");
// const routePeminjaman = require("./routes/routeUser");
// const routeAdmin = require("./routes/routeAdmin");
// const routeSensor = require("./routes/routeSensor");
// const routeNotification = require("./routes/routeNotification");
// const connectDb = require("./config/db");

// const sensorController = require("./controllers/sensorController");

// const { initializeWebSocket } = require("./controllers/sensorController");
// const { updateExpiredPeminjaman } = require("./controllers/userController");
// const { getAndUpdateCounts } = require("./controllers/countController");

// const app = express();
// // const server = http.createServer((req, res) => {
// //     // Log all incoming requests
// //     console.log('[HTTP] Incoming request:', req.method, req.url);
// //     app(req, res);
// // });
// const server = http.createServer(app);


// const admin = require('firebase-admin');
// const serviceAccount = require('./pushnotification-fe894-firebase-adminsdk-6o36a-b5a82eb18b.json');

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount)
// });

// // Debug logging middleware
// // app.use((req, res, next) => {
// //     console.log('[HTTP] Request:', req.method, req.url);
// //     if (req.headers.upgrade !== 'websocket') {
// //         console.log('[HTTP] Headers:', req.headers);
// //     }
// //     next();
// // });

// // CORS configuration
// // app.use(cors({
// //     origin: '*',
// //     methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
// //     allowedHeaders: ['Content-Type', 'Authorization']
// // }));

// // Cache setup
// const cache = new NodeCache({ stdTTL: 100 });

// // Enable compression for faster response
// app.use(compression());

// app.use(cors());

// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// // Connect to database
// connectDb();

// // Initialize WebSocket
// // console.log("Setting up WebSocket server...");
// const wss = setupWebSocketServer(server);
// sensorController.initializeWebSocket(wss);
// // console.log("WebSocket server setup complete");

// app.get("/", (req, res) => {
//   res.send("API Ready");
// });

// app.use("/admin", routeAdmin);
// app.use("/auth", routeUser);
// app.use("/user", routePeminjaman);
// app.use("/sensor", routeSensor);
// app.use("/notifications", routeNotification);

// // Special handling for sensor routes
// // app.use("/sensor", (req, res, next) => {
// //   console.log("[HTTP] Sensor route request:", req.method, req.url);
// //   if (
// //     req.headers.upgrade &&
// //     req.headers.upgrade.toLowerCase() === "websocket"
// //   ) {
// //     console.log("[HTTP] WebSocket upgrade request detected");
// //     return next();
// //   }
// //   console.log("[HTTP] Regular HTTP request, passing to sensor routes");
// //   routeSensor(req, res, next);
// // });

// const port = process.env.PORT || 5000;

// // Start server
// server.listen(port, async () => {
//   console.log(`Server berjalan di port ${port}`);
//   try {
//     // Perbarui data expired peminjaman dan count saat startup
//     await updateExpiredPeminjaman();
//     await getAndUpdateCounts();
//     // console.log("Initial update of expired peminjaman and counts completed");

//     // Schedule task to update peminjaman and counts every 5 minutes
//     scheduleUpdateExpiredPeminjaman();
//   } catch (error) {
//     console.error("Error during startup:", error);
//   }
// });

// // Fungsi untuk menjalankan pembaruan secara berkala setiap 5 menit
// const scheduleUpdateExpiredPeminjaman = () => {
//   cron.schedule("*/5 * * * *", async () => {
//     // console.log("Menjalankan pemeriksaan peminjaman kedaluwarsa...");
//     try {
//       await updateExpiredPeminjaman();
//       await getAndUpdateCounts();
//       // console.log(
//       //   "Pemeriksaan peminjaman kedaluwarsa dan update counts selesai"
//       // );
//     } catch (error) {
//       console.error("Error during scheduled update:", error);
//     }
//   });
// };

// --------------------------------------------------------------------------------------------------------- //

// Handle WebSocket upgrade
// index.js

// Handle WebSocket upgrade
// server.on('upgrade', (request, socket, head) => {
//     const pathname = request.url;

//     if (pathname.startsWith('/sensor/') && pathname.endsWith('/updateCurrent')) {
//         console.log('[WebSocket] Upgrade request for:', pathname);

//         // Make sure handleUpgrade is called only once
//         wss.handleUpgrade(request, socket, head, (ws) => {
//             wss.emit('connection', ws, request);
//         });
//     } else {
//         // If path is invalid, destroy the socket and avoid multiple upgrade attempts
//         socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
//         socket.destroy();
//     }
// });

// app.listen(port, async () => {

//     console.log(`Server berjalan di port ${port}`);
//     await updateExpiredPeminjaman();
//     console.log('Initial update of expired peminjaman completed');
// })
