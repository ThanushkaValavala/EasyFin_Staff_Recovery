import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import CasesListScreen from './src/screens/CasesListScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import CaseDetailScreen from './src/screens/CaseDetailScreen';
import StartRecoveryScreen from './src/screens/StartRecoveryScreen';
import ActiveRecoveryScreen from './src/screens/ActiveRecoveryScreen';
import CompleteScreen from './src/screens/CompleteScreen';
import CollectionsHistoryScreen from './src/screens/CollectionsHistoryScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'Home') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'Cases') iconName = focused ? 'briefcase' : 'briefcase-outline';
          else if (route.name === 'Profile') iconName = focused ? 'person' : 'person-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#2563EB',
        tabBarInactiveTintColor: '#94A3B8',
      })}
    >
      <Tab.Screen name="Home" component={DashboardScreen} />
      <Tab.Screen name="Cases" component={CasesListScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Login">
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="CaseDetail" component={CaseDetailScreen} options={{ title: 'Case details' }} />
          <Stack.Screen name="StartRecovery" component={StartRecoveryScreen} options={{ title: 'Start recovery' }} />
          <Stack.Screen name="ActiveRecovery" component={ActiveRecoveryScreen} options={{ title: 'Recovery in progress', headerBackVisible: false, gestureEnabled: false }} />
          <Stack.Screen name="Complete" component={CompleteScreen} options={{ title: 'Proof and outcome', headerBackVisible: false, gestureEnabled: false }} />
          <Stack.Screen name="CollectionsHistory" component={CollectionsHistoryScreen} options={{ title: 'Collections' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}