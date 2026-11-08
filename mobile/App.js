import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import StartRecoveryScreen from './src/screens/StartRecoveryScreen';
import ActiveRecoveryScreen from './src/screens/ActiveRecoveryScreen';
import CompleteScreen from './src/screens/CompleteScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Login">
          {/* Mobile OTP Authentication */}
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />

          {/* Main Dashboard (3 Cards: Assigned Tasks, Start Recovery, Profile) */}
          <Stack.Screen
            name="MainTabs"
            component={DashboardScreen}
            options={{ headerShown: false }}
          />

          {/* Recovery Workflow: Transport Selection & Evidence */}
          <Stack.Screen
            name="StartRecovery"
            component={StartRecoveryScreen}
            options={{
              title: 'Start Recovery',
              headerBackTitle: 'Dashboard',
              headerTintColor: '#0F172A',
            }}
          />

          {/* Live GPS Tracking (Active Recovery) */}
          <Stack.Screen
            name="ActiveRecovery"
            component={ActiveRecoveryScreen}
            options={{
              title: 'Recovery in Progress',
              headerBackVisible: false,
              gestureEnabled: false,
              headerTintColor: '#0F172A',
            }}
          />

          {/* Stop Recovery & Completion Form */}
          <Stack.Screen
            name="Complete"
            component={CompleteScreen}
            options={{
              title: 'Complete Recovery',
              headerBackVisible: false,
              gestureEnabled: false,
              headerTintColor: '#0F172A',
            }}
          />

          {/* Profile & Recovery History */}
          <Stack.Screen
            name="Profile"
            component={ProfileScreen}
            options={{
              title: 'Agent Profile & History',
              headerTintColor: '#0F172A',
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
