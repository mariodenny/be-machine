// config/websocketServer.js

const WebSocket = require("ws");
const { getModelByType } = require("../utils/modelHelper");

let wssInstance = null;

function setupWebSocketServer(server) {
  // console.log("[WebSocket] Initializing WebSocket server...");

  const wss = new WebSocket.Server({
    noServer: true,
    clientTracking: true, // Enable client tracking to manage connections
    maxPayload: 1024 * 1024, // 1MB maximum payload
  });

  // Handle WebSocket connection events
  // Handle WebSocket connection events
  wss.on("connection", async (ws, req) => {
    const pathname = req.url;
    const machineType = pathname.split("/")[2];
    console.log(`[WebSocket] New client connected for ${machineType}`);

    // Set properties for connection management
    ws.machineType = machineType;
    ws.isAlive = true;

    // Handle pong event to update isAlive status
    ws.on("pong", () => {
      ws.isAlive = true;
      console.log("[WebSocket] Pong received");
    });

    try {
      // Fetch initial data
      const Model = getModelByType(machineType, "sensor");
      const latestData = await Model.findOne({
        current: { $exists: true },
      }).sort({ waktu: -1 });

      // Prepare initial message to send
      const initialMessage = JSON.stringify({
        type: "connected",
        success: true,
        data: {
          current: latestData?.current || 0,
          waktu: latestData?.waktu || new Date().toISOString(),
        },
      });

      // Check if the connection is open before sending the message
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(initialMessage, (error) => {
          if (error) {
            console.error("[WebSocket] Error sending initial data:", error);
          } else {
            console.log("[WebSocket] Initial data sent successfully");
          }
        });
      }
    } catch (e) {
      console.error("[WebSocket] Error during data fetching:", e);
    }

    // Handle incoming messages from clients
    ws.on("message", (message) => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.log(
          "[WebSocket] Connection is not open, skipping message handling"
        );
        return;
      }

      try {
        const data = JSON.parse(message);
        console.log("[WebSocket] Received message:", data);

        // Echo the message back to the client
        ws.send(JSON.stringify({ type: "received", data }));
      } catch (e) {
        console.error("[WebSocket] Error parsing message:", e);
      }
    });

    // Handle ping event for keeping the connection alive
    ws.on("ping", () => {
      console.log("[WebSocket] Ping received");
      ws.pong(); // Respond with pong
    });

    // Handle connection errors
    ws.on("error", (error) => {
      console.error("[WebSocket] Connection error:", error);
      try {
        ws.close();
      } catch (closeError) {
        console.error("[WebSocket] Error closing connection:", closeError);
      }
    });

    // Handle connection close event
    ws.on("close", (code, reason) => {
      console.log(
        `[WebSocket] Connection closed for ${machineType} - Code: ${code}, Reason: ${reason}`
      );
      ws.isAlive = false;
    });

    // Send an initial ping to establish connection status
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping((error) => {
        if (error) {
          console.error("[WebSocket] Error sending initial ping:", error);
        }
      });
    }
  });

  // Handle WebSocket upgrade requests
  server.on("upgrade", (request, socket, head) => {
    const pathname = request.url;
    console.log("[WebSocket] Upgrade request received for:", pathname);

    // Validate the WebSocket URL path
    if (!pathname.match(/^\/sensor\/\w+\/updateCurrent$/)) {
      console.log("[WebSocket] Invalid path:", pathname);
      // Write an HTTP response to the socket and destroy it
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return; // Early return to ensure handleUpgrade is not called
    }

    // Handle the WebSocket upgrade if the path matches
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  // Interval to keep connections alive using ping-pong
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.log("[WebSocket] Connection not open, skipping ping");
        return;
      }

      if (!ws.isAlive) {
        console.log(
          "[WebSocket] Client not responding, terminating connection"
        );
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping((error) => {
        if (error) {
          console.error("[WebSocket] Error during ping:", error);
        }
      });
    });
  }, 30000); // Ping every 30 seconds

  // Clean up interval on server close
  wss.on("close", () => {
    clearInterval(pingInterval);
  });

  wssInstance = wss;
  console.log("[WebSocket] WebSocket server initialized successfully");
  return wss;
}

// Function to broadcast a message to all connected clients of a specific type
function broadcastCurrent(current, type) {
  if (!wssInstance) {
    console.log("[WebSocket] WebSocket server not initialized");
    return;
  }

  const message = JSON.stringify({
    type: "current_update",
    data: {
      current: parseFloat(current),
      waktu: new Date().toISOString(),
    },
  });

  let sentCount = 0;
  wssInstance.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.machineType === type) {
      client.send(message, (error) => {
        if (error) {
          console.error("[WebSocket] Error during broadcast:", error);
        } else {
          sentCount++;
        }
      });
    }
  });

  console.log(`[WebSocket] Broadcast message sent to ${sentCount} clients`);
}

module.exports = {
  setupWebSocketServer,
  broadcastCurrent,
};
