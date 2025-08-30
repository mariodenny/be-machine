#include <WiFi.h>
#include <WiFiClientSecure.h>  // Untuk SSL connection ke HiveMQ Cloud
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <max6675.h>  // Library untuk Thermocouple Type K

// ---------------- WIFI CONFIG ----------------
const char* ssid = "YOUR_WIFI_SSID";        // Ganti dengan nama WiFi kamu
const char* password = "YOUR_WIFI_PASSWORD"; // Ganti dengan password WiFi kamu

// ---------------- HIVEMQ CLOUD CONFIG ----------------
const char* mqtt_server = "5a4b12ea6b7e4a879fcd9b34a94de671.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char* mqtt_username = "esp-be-machine";
const char* mqtt_password = "Be_Machine@123";

WiFiClientSecure espClient;  // Secure client untuk SSL
PubSubClient client(espClient);

// ---------------- PIN CONFIGURATION ----------------
// Thermocouple Type K (MAX6675)
#define THERMO_SO_PIN   19
#define THERMO_CS_PIN   5
#define THERMO_SCK_PIN  18

// Pressure Transmitter (Analog)
#define PRESSURE_PIN    36  // GPIO 36 (VP) - A0 di ESP32

// SW-420 Vibration Sensor (Digital)
#define VIBRATION_PIN   4

// MAX6675 instance untuk thermocouple
MAX6675 thermocouple(THERMO_SCK_PIN, THERMO_CS_PIN, THERMO_SO_PIN);

// ---------------- STRUKTUR SENSOR ----------------
struct Sensor {
  String sensorId;
  String sensorType;  // "suhu", "tekanan", "getaran"
  bool isActive;
  unsigned long lastRead;
  unsigned long readInterval;
  float lastValue;
  int pinNumber;  // Pin untuk sensor ini
};

// ---------------- GLOBAL VARIABEL ----------------
String chipId;
String machineId = "";
String rentalId = "";
unsigned long lastSend = 0;
unsigned long lastHeartbeat = 0;
unsigned long statusInterval = 5000; // interval kirim status umum
unsigned long heartbeatInterval = 30000; // heartbeat setiap 30 detik
bool isStarted = false;
bool mqttConnected = false;

// Array untuk menyimpan sensor-sensor
Sensor sensors[10]; // maksimal 10 sensor
int sensorCount = 0;

// ---------------- FUNGSI SENSOR INDIVIDUAL ----------------

// Function untuk sensor suhu - Thermocouple Type K dengan MAX6675
float readSuhuSensor(String sensorId) {
  float temperature = thermocouple.readCelsius();
  
  // Cek error reading
  if (isnan(temperature) || temperature < -50 || temperature > 1000) {
    Serial.println("Error: Thermocouple [" + sensorId + "] reading error!");
    return -999.0; // Error value
  }
  
  Serial.println("Thermocouple [" + sensorId + "]: " + String(temperature) + "°C");
  return temperature;
}

// Function untuk sensor tekanan - Pressure Transmitter (0-12 Bar, 0.5-4.5V)
float readTekananSensor(String sensorId) {
  int adcValue = analogRead(PRESSURE_PIN);
  
  // Konversi ADC ke voltage (ESP32 ADC 12-bit, Vref 3.3V)
  float voltage = (adcValue / 4095.0) * 3.3;
  
  // Konversi voltage ke pressure (0.5V = 0 Bar, 4.5V = 12 Bar)
  // Formula: pressure = (voltage - 0.5) * (12 / 4.0)
  float pressure = 0.0;
  if (voltage >= 0.5) {
    pressure = (voltage - 0.5) * 3.0; // 3.0 = 12/4
  }
  
  // Batasi range 0-12 Bar
  if (pressure < 0) pressure = 0;
  if (pressure > 12) pressure = 12;
  
  Serial.println("🔧 Pressure Sensor [" + sensorId + "]: " + String(pressure) + " Bar (ADC: " + String(adcValue) + ", V: " + String(voltage, 2) + ")");
  return pressure;
}

// Function untuk sensor getaran - SW-420 (Digital Output)
float readGetaranSensor(String sensorId) {
  int vibrationState = digitalRead(VIBRATION_PIN);
  
  // SW-420: LOW = getaran terdeteksi, HIGH = tidak ada getaran
  float vibrationLevel = (vibrationState == LOW) ? 1.0 : 0.0;
  
  String status = (vibrationLevel > 0) ? "TERDETEKSI" : "NORMAL";
  Serial.println("Vibration Sensor [" + sensorId + "]: " + status + " (" + String(vibrationLevel) + ")");
  
  return vibrationLevel;
}

// Function utama untuk execute sensor berdasarkan tipe
float executeSensor(Sensor &sensor) {
  float value = 0.0;
  
  if (sensor.sensorType == "suhu") {
    value = readSuhuSensor(sensor.sensorId);
  } 
  else if (sensor.sensorType == "tekanan") {
    value = readTekananSensor(sensor.sensorId);
  } 
  else if (sensor.sensorType == "getaran") {
    value = readGetaranSensor(sensor.sensorId);
  }
  else {
    Serial.println("Tipe sensor tidak dikenal: " + sensor.sensorType);
    return 0.0;
  }
  
  sensor.lastValue = value;
  sensor.lastRead = millis();
  return value;
}

// ---------------- FUNGSI MQTT CALLBACK ----------------
void callback(char* topic, byte* payload, unsigned int length) {
  payload[length] = '\0';
  String message = String((char*)payload);
  Serial.printf("Message arrived [%s]: %s\n", topic, message.c_str());
  String topicStr = String(topic);

  // Handle config dari server (rental data)
  if (topicStr.endsWith("/config")) {
    StaticJsonDocument<1024> doc;
    DeserializationError err = deserializeJson(doc, message);
    if (!err) {
      // Parse config utama
      rentalId = doc["rentalId"] | "";
      machineId = doc["machineId"] | "";
      statusInterval = doc["statusInterval"] | 5000;
      
      // Parse sensors array
      JsonArray sensorsArray = doc["sensors"];
      sensorCount = 0;
      
      for (JsonObject sensorObj : sensorsArray) {
        if (sensorCount < 10) { // limit array
          sensors[sensorCount].sensorId = sensorObj["sensorId"] | "";
          sensors[sensorCount].sensorType = sensorObj["sensorType"] | "";
          sensors[sensorCount].isActive = sensorObj["isActive"] | false;
          sensors[sensorCount].readInterval = sensorObj["readInterval"] | 10000;
          sensors[sensorCount].lastRead = 0;
          sensors[sensorCount].lastValue = 0.0;
          sensorCount++;
        }
      }
      
      Serial.println("🔧 === CONFIG DITERIMA ===");
      Serial.println("📋 Rental ID: " + rentalId);
      Serial.println("🏭 Machine ID: " + machineId);
      Serial.println("⏱️  Status Interval: " + String(statusInterval) + "ms");
      Serial.println("📊 Jumlah Sensor: " + String(sensorCount));
      
      for (int i = 0; i < sensorCount; i++) {
        Serial.println("   Sensor " + String(i+1) + ": " + 
                      sensors[i].sensorId + " (" + 
                      sensors[i].sensorType + ") - " + 
                      (sensors[i].isActive ? "AKTIF ✅" : "NONAKTIF ❌"));
      }
    } else {
      Serial.println("❌ Error parsing config JSON: " + String(err.c_str()));
    }
  }
  
  // Handle command
  else if (topicStr.endsWith("/command")) {
    if (message == "start") {
      isStarted = true;
      Serial.println("🚀 === MESIN DIHIDUPKAN ===");
    } else if (message == "stop") {
      isStarted = false;
      Serial.println("🛑 === MESIN DIMATIKAN ===");
    } else {
      Serial.println("❓ Unknown command: " + message);
    }
  }
}

// ---------------- FUNGSI MQTT RECONNECT ----------------
void reconnect() {
  while (!client.connected()) {
    Serial.print("🔄 Menghubungkan ke HiveMQ Cloud...");
    
    // Create unique client ID
    String clientId = "ESP32-" + chipId + "-" + String(random(0xffff), HEX);
    
    if (client.connect(clientId.c_str(), mqtt_username, mqtt_password)) {
      Serial.println(" ✅ Terhubung!");
      mqttConnected = true;
      
      // Subscribe topics
      String configTopic = "machine/" + chipId + "/config";
      String commandTopic = "machine/" + chipId + "/command";
      
      bool configSub = client.subscribe(configTopic.c_str(), 1);
      bool commandSub = client.subscribe(commandTopic.c_str(), 1);
      
      Serial.println("📥 Subscribed topics:");
      Serial.println("   - " + configTopic + (configSub ? " ✅" : " ❌"));
      Serial.println("   - " + commandTopic + (commandSub ? " ✅" : " ❌"));
      
      // Send connection status
      sendConnectionStatus(true);
      
    } else {
      mqttConnected = false;
      Serial.print(" ❌ Gagal, rc=");
      Serial.print(client.state());
      Serial.println(". Error codes:");
      Serial.println("   -4: connection timeout");
      Serial.println("   -3: connection lost");
      Serial.println("   -2: connect failed");
      Serial.println("   -1: disconnected");
      Serial.println("    0: connected");
      Serial.println("    1: bad protocol");
      Serial.println("    2: bad client ID");
      Serial.println("    3: unavailable");
      Serial.println("    4: bad credentials");
      Serial.println("    5: unauthorized");
      Serial.println("⏳ Retry dalam 5 detik...");
      delay(5000);
    }
  }
}

// ---------------- FUNGSI KIRIM CONNECTION STATUS ----------------
void sendConnectionStatus(bool connected) {
  StaticJsonDocument<256> doc;
  doc["chipId"] = chipId;
  doc["status"] = connected ? "online" : "offline";
  doc["timestamp"] = millis();
  doc["ip"] = WiFi.localIP().toString();
  doc["rssi"] = WiFi.RSSI();
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/connection";
  client.publish(topic.c_str(), buffer, true); // retained message
  
  Serial.println("📡 Connection status sent: " + String(connected ? "ONLINE" : "OFFLINE"));
}

// ---------------- FUNGSI KIRIM STATUS UMUM ----------------
void sendMachineStatus() {
  if (machineId == "" || !mqttConnected) return;
  
  StaticJsonDocument<512> doc;
  doc["machineId"] = machineId;
  doc["rentalId"] = rentalId;
  doc["status"] = isStarted ? "ON" : "OFF";
  doc["timestamp"] = millis();
  doc["activeSensors"] = sensorCount;
  doc["chipId"] = chipId;
  doc["uptime"] = millis() / 1000;
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["wifiRSSI"] = WiFi.RSSI();
  
  char buffer[512];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + machineId + "/status";
  bool published = client.publish(topic.c_str(), buffer, 0);
  
  if (published) {
    Serial.println("📊 Status mesin dikirim: " + String(isStarted ? "ON" : "OFF"));
  } else {
    Serial.println("❌ Failed to send machine status");
  }
}

// ---------------- FUNGSI KIRIM DATA SENSOR ----------------
void sendSensorData(Sensor &sensor) {
  if (!mqttConnected || machineId == "") return;
  
  StaticJsonDocument<256> doc;
  doc["sensorId"] = sensor.sensorId;
  doc["machineId"] = machineId;
  doc["rentalId"] = rentalId;
  doc["sensorType"] = sensor.sensorType;
  doc["value"] = sensor.lastValue;
  doc["timestamp"] = millis();
  doc["chipId"] = chipId;
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "sensor/" + sensor.sensorId + "/data";
  bool published = client.publish(topic.c_str(), buffer, 0);
  
  if (published) {
    Serial.println("📤 Data sensor dikirim [" + sensor.sensorType + "]: " + String(sensor.lastValue));
  } else {
    Serial.println("❌ Failed to send sensor data: " + sensor.sensorType);
  }
}

// ---------------- FUNGSI KIRIM HEARTBEAT ----------------
void sendHeartbeat() {
  if (!mqttConnected) return;
  
  StaticJsonDocument<256> doc;
  doc["chipId"] = chipId;
  doc["timestamp"] = millis();
  doc["uptime"] = millis() / 1000;
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["wifiRSSI"] = WiFi.RSSI();
  doc["machineId"] = machineId;
  doc["isStarted"] = isStarted;
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + chipId + "/heartbeat";
  client.publish(topic.c_str(), buffer, 0);
  
  Serial.println("💓 Heartbeat sent - Uptime: " + String(millis()/1000) + "s, Free Heap: " + String(ESP.getFreeHeap()));
}

// ---------------- FUNGSI SETUP ----------------
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("🚀 === ESP32 MULTI-SENSOR STARTING ===");
  
  // Setup pin modes
  pinMode(VIBRATION_PIN, INPUT);
  pinMode(PRESSURE_PIN, INPUT);
  
  // Get chip ID
  chipId = String((uint32_t)ESP.getEfuseMac(), HEX);
  chipId.toUpperCase();
  Serial.println("🆔 Chip ID: " + chipId);
  
  // WiFi Connection
  Serial.println("📶 Connecting to WiFi: " + String(ssid));
  WiFi.begin(ssid, password);
  
  int wifiAttempts = 0;
  while (WiFi.status() != WL_CONNECTED && wifiAttempts < 20) {
    delay(500);
    Serial.print(".");
    wifiAttempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("");
    Serial.println("✅ WiFi connected!");
    Serial.println("📡 IP address: " + WiFi.localIP().toString());
    Serial.println("📶 Signal strength: " + String(WiFi.RSSI()) + " dBm");
  } else {
    Serial.println("");
    Serial.println("❌ WiFi connection failed!");
    Serial.println("🔄 Restarting in 10 seconds...");
    delay(10000);
    ESP.restart();
  }
  
  // SSL setup untuk HiveMQ Cloud
  espClient.setInsecure();  // Skip certificate verification (untuk testing)
  
  // MQTT setup
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setKeepAlive(60);
  client.setSocketTimeout(30);
  
  // Tunggu MAX6675 ready
  delay(500);
  
  Serial.println("🌡️  Testing sensors...");
  Serial.println("   - Thermocouple Type K (MAX6675)");
  Serial.println("     Pins -> SCK:" + String(THERMO_SCK_PIN) + " CS:" + String(THERMO_CS_PIN) + " SO:" + String(THERMO_SO_PIN));
  Serial.println("   - Pressure Transmitter (0-12Bar)");
  Serial.println("     Pin -> " + String(PRESSURE_PIN));
  Serial.println("   - SW-420 Vibration Sensor");
  Serial.println("     Pin -> " + String(VIBRATION_PIN));
  
  // Test sensor readings
  float testTemp = thermocouple.readCelsius();
  int testPressure = analogRead(PRESSURE_PIN);
  int testVibration = digitalRead(VIBRATION_PIN);
  
  Serial.println("📊 Initial sensor readings:");
  Serial.println("   - Temperature: " + String(testTemp) + "°C");
  Serial.println("   - Pressure ADC: " + String(testPressure));
  Serial.println("   - Vibration: " + String(testVibration));
  
  Serial.println("🔌 Connecting to HiveMQ Cloud...");
  Serial.println("   Host: " + String(mqtt_server));
  Serial.println("   Port: " + String(mqtt_port));
  Serial.println("   Username: " + String(mqtt_username));
  
  Serial.println("✅ === ESP32 MULTI-SENSOR READY ===");
}

// ---------------- FUNGSI LOOP ----------------
void loop() {
  // Check WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ WiFi disconnected! Reconnecting...");
    WiFi.begin(ssid, password);
    delay(5000);
    return;
  }
  
  // Check MQTT connection
  if (!client.connected()) {
    mqttConnected = false;
    reconnect();
  }
  client.loop();
  
  unsigned long now = millis();
  
  // Send heartbeat
  if (now - lastHeartbeat > heartbeatInterval) {
    lastHeartbeat = now;
    sendHeartbeat();
  }
  
  // Kirim status mesin secara berkala
  if (machineId != "" && now - lastSend > statusInterval) {
    lastSend = now;
    sendMachineStatus();
  }
  
  // Proses setiap sensor jika mesin aktif
  if (isStarted && machineId != "" && mqttConnected) {
    for (int i = 0; i < sensorCount; i++) {
      Sensor &sensor = sensors[i];
      
      // Cek apakah sensor aktif dan sudah waktunya dibaca
      if (sensor.isActive && (now - sensor.lastRead > sensor.readInterval)) {
        // Execute sensor sesuai tipenya
        float value = executeSensor(sensor);
        
        // Kirim data sensor (hanya jika bukan error value)
        if (value != -999.0) {
          sendSensorData(sensor);
        }
      }
    }
  }
  
  delay(100); // Small delay to prevent watchdog
}