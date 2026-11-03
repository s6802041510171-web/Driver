# Green Driver Eco-Meter · Expo Go

A React Native app for testing with Expo Go on Android and iOS.

## Run the app

Open Command Prompt in the project folder and run:

```cmd
npm install
npx expo start --go --lan
```

Open Expo Go on a phone connected to the same Wi-Fi network as your computer, then scan the QR code shown in the terminal. On a physical iPhone, sign in to Expo Go and Expo CLI with the same Expo account.

## Available in Expo Go

- Record GPS location, speed, distance, and route while the app is open
- Read Accelerometer and Gyroscope data during a trip
- Display maps and routes with `react-native-maps`
- Summarize driving scores and trip events

## Limitations

- Expo Go does not support the Bluetooth LE module (`react-native-ble-plx`), so the app shows an explanation instead of scanning for devices. BLE requires adding the package and native configuration, then creating an Android development build.
- Location tracking runs only while the app is open.
- Driving scores are an initial estimate based on phone motion. Saved trips stay in memory until the app is closed.
- Maps can be tested in Expo Go without an API key. A standalone APK/AAB may require a Google Maps API key.
"# Driver" 
