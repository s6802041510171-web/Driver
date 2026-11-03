module.exports = ({ config }) => ({
  ...config,
  name: 'Green Driver',
  slug: 'green-driver',
  owner: 'tawan01',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  extra: {
    ...config.extra,
    eas: {
      ...config.extra?.eas,
      projectId: '60f2d904-a087-43b3-8852-8499cc3696d7',
    },
  },
  android: {
    ...config.android,
    package: 'com.greendriver.ecometer',
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
  },
  plugins: [
    ['expo-location', { locationWhenInUsePermission: 'Green Driver uses your location to record your route, speed, and distance during a trip.' }],
    ['expo-sensors', { motionPermission: 'Green Driver uses motion sensors to assess your driving.' }],
  ],
});
