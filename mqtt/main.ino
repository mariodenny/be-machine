#include <WiFi.h>
#include <WiFiClientSecure.h>  // Untuk SSL connection ke HiveMQ Cloud
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <max6675.h>  // Library untuk Thermocouple Type K

// ---------------- WIFI CONFIG ----------------
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// ---------------- MQTT CONFIG ----------------
const char* mqtt_server = "192.168.1.100";
WiFiClient espClient;
PubSubClient client(espClient);

// ---------------- PIN CONFIGURATION ----------------
// Thermocouple Type K (MAX6675)
#define THERMO_SO_PIN   19
#define THERMO_CS_PIN   5
#define THERMO_SCK_PIN  18

// Pressure Transmitter (Analog)
#define PRESSURE_PIN    A0  // GPIO 36 (VP)

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
unsigned long statusInterval = 5000; // interval kirim status umum
bool isStarted = false;

// Array untuk menyimpan sensor-sensor
Sensor sensors[10]; // maksimal 10 sensor
int sensorCount = 0;

// ---------------- FUNGSI SENSOR INDIVIDUAL ----------------

// Function untuk sensor suhu - Thermocouple Type K dengan MAX6675
float readSuhuSensor(String sensorId) {
  float temperature = thermocouple.readCelsius();
  
  // Cek error reading
  if (isnan(temperature)) {
    Serial.println("Error: Thermocouple [" + sensorId + "] tidak terhubung!");
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
  
  Serial.println("Pressure Sensor [" + sensorId + "]: " + String(pressure) + " Bar (ADC: " + String(adcValue) + ", V: " + String(voltage) + ")");
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
      
      Serial.println("=== CONFIG DITERIMA ===");
      Serial.println("Rental ID: " + rentalId);
      Serial.println("Machine ID: " + machineId);
      Serial.println("Status Interval: " + String(statusInterval));
      Serial.println("Jumlah Sensor: " + String(sensorCount));
      
      for (int i = 0; i < sensorCount; i++) {
        Serial.println("Sensor " + String(i+1) + ": " + 
                      sensors[i].sensorId + " (" + 
                      sensors[i].sensorType + ") - " + 
                      (sensors[i].isActive ? "AKTIF" : "NONAKTIF"));
      }
    } else {
      Serial.println("Error parsing config JSON");
    }
  }
  
  // Handle command
  else if (topicStr.endsWith("/command")) {
    if (message == "start") {
      isStarted = true;
      Serial.println("=== MESIN DIHIDUPKAN ===");
    } else if (message == "stop") {
      isStarted = false;
      Serial.println("=== MESIN DIMATIKAN ===");
    }
  }
}

// ---------------- FUNGSI MQTT RECONNECT ----------------
void reconnect() {
  while (!client.connected()) {
    Serial.print("Menghubungkan ke MQTT...");
    if (client.connect(chipId.c_str())) {
      Serial.println("Terhubung");
      
      // Subscribe topics
      String configTopic = "machine/" + chipId + "/config";
      String commandTopic = "machine/+/command";
      
      client.subscribe(configTopic.c_str());
      client.subscribe(commandTopic.c_str());
      
      Serial.println("Subscribed to:");
      Serial.println("- " + configTopic);
      Serial.println("- " + commandTopic);
    } else {
      Serial.print("Gagal, rc=");
      Serial.print(client.state());
      delay(3000);
    }
  }
}

// ---------------- FUNGSI KIRIM STATUS UMUM ----------------
void sendMachineStatus() {
  if (machineId == "") return;
  
  StaticJsonDocument<512> doc;
  doc["machineId"] = machineId;
  doc["rentalId"] = rentalId;
  doc["status"] = isStarted ? "ON" : "OFF";
  doc["timestamp"] = millis();
  doc["activeSensors"] = sensorCount;
  
  char buffer[512];
  serializeJson(doc, buffer);
  
  String topic = "machine/" + machineId + "/status";
  client.publish(topic.c_str(), buffer);
  
  Serial.println("Status mesin dikirim: " + String(buffer));
}

// ---------------- FUNGSI KIRIM DATA SENSOR ----------------
void sendSensorData(Sensor &sensor) {
  StaticJsonDocument<256> doc;
  doc["sensorId"] = sensor.sensorId;
  doc["machineId"] = machineId;
  doc["rentalId"] = rentalId;
  doc["sensorType"] = sensor.sensorType;
  doc["value"] = sensor.lastValue;
  doc["timestamp"] = millis();
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  String topic = "sensor/" + sensor.sensorId + "/data";
  client.publish(topic.c_str(), buffer);
  
  Serial.println("Data sensor dikirim [" + sensor.sensorType + "]: " + String(buffer));
}

// ---------------- FUNGSI SETUP ----------------
void setup() {
  Serial.begin(115200);
  
  // Setup pin modes
  pinMode(VIBRATION_PIN, INPUT);
  pinMode(PRESSURE_PIN, INPUT);
  
  // Get chip ID
  chipId = String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.println("Chip ID: " + chipId);
  
  // WiFi
  WiFi.begin(ssid, password);
  Serial.print("Menghubungkan ke WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi terhubung: " + WiFi.localIP().toString());
  
  // MQTT HiveMQ Cloud Setup
  espClient.setInsecure();  // Skip certificate verification (untuk testing)
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  
  // Tunggu MAX6675 ready
  delay(500);
  
  Serial.println("=== ESP32 MULTI-SENSOR READY ===");
  Serial.println("Sensors:");
  Serial.println("- Thermocouple Type K (MAX6675) - Pin SCK:" + String(THERMO_SCK_PIN) + " CS:" + String(THERMO_CS_PIN) + " SO:" + String(THERMO_SO_PIN));
  Serial.println("- Pressure Transmitter (0-12Bar) - Pin:" + String(PRESSURE_PIN));
  Serial.println("- SW-420 Vibration Sensor - Pin:" + String(VIBRATION_PIN));
}

// ---------------- FUNGSI LOOP ----------------
void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();
  
  unsigned long now = millis();
  
  // Kirim status mesin secara berkala
  if (machineId != "" && now - lastSend > statusInterval) {
    lastSend = now;
    sendMachineStatus();
  }
  
  // Proses setiap sensor jika mesin aktif
  if (isStarted && machineId != "") {
    for (int i = 0; i < sensorCount; i++) {
      Sensor &sensor = sensors[i];
      
      // Cek apakah sensor aktif dan sudah waktunya dibaca
      if (sensor.isActive && (now - sensor.lastRead > sensor.readInterval)) {
        // Execute sensor sesuai tipenya
        float value = executeSensor(sensor);
        
        // Kirim data sensor
        sendSensorData(sensor);
      }
    }
  }
  
  delay(100); // Small delay to prevent watchdog
}