import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ParentHomeScreen from '../screens/Parent/ParentHomeScreen';
import TeacherHomeScreen from '../screens/Teacher/TeacherHomeScreen';
import SchoolHomeScreen from '../screens/School/SchoolHomeScreen';
import { TabRouteName } from '../types/navigation';

const Tab = createBottomTabNavigator();

type HomeTabsNavigatorProps = {
  tabRoutes: TabRouteName[];
};

export default function HomeTabsNavigator({ tabRoutes }: HomeTabsNavigatorProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const desktopWeb = Platform.OS === 'web' && width >= 1024;
  const defaultHomeTab = tabRoutes.includes('School') ? 'School' : tabRoutes[0] ?? 'School';

  const tabIcon = (routeName: TabRouteName, focused: boolean) => {
    const color = focused ? '#1d4ed8' : '#6b7280';

    switch (routeName) {
      case 'Parent':
        return <Ionicons name={focused ? 'people' : 'people-outline'} size={24} color={color} />;
      case 'Teacher':
        return <Ionicons name={focused ? 'school' : 'school-outline'} size={24} color={color} />;
      case 'School':
        return <Ionicons name={focused ? 'business' : 'business-outline'} size={24} color={color} />;
      default:
        return null;
    }
  };

  return (
    <Tab.Navigator
      initialRouteName={defaultHomeTab}
      screenOptions={{
        headerShown: false,
        tabBarPosition: desktopWeb ? 'top' : 'bottom',
        tabBarActiveTintColor: '#1d4ed8',
        tabBarInactiveTintColor: '#6b7280',
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
          marginBottom: 2,
        },
        tabBarItemStyle: {
          paddingTop: 6,
          paddingBottom: 6,
        },
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: desktopWeb ? 'transparent' : '#e5e7eb',
          borderBottomColor: desktopWeb ? '#e5e7eb' : 'transparent',
          height: desktopWeb ? 54 : 68 + insets.bottom,
          paddingBottom: desktopWeb ? 6 : Math.max(insets.bottom, 10),
          paddingTop: desktopWeb ? 6 : 8,
          paddingHorizontal: 8,
        },
      }}
    >
      {tabRoutes.includes('School') ? (
        <Tab.Screen
          name="School"
          component={SchoolHomeScreen}
          options={{ tabBarIcon: ({ focused }) => tabIcon('School', focused) }}
        />
      ) : null}
      {tabRoutes.includes('Parent') ? (
        <Tab.Screen
          name="Parent"
          component={ParentHomeScreen}
          options={{ tabBarIcon: ({ focused }) => tabIcon('Parent', focused) }}
        />
      ) : null}
      {tabRoutes.includes('Teacher') ? (
        <Tab.Screen
          name="Teacher"
          component={TeacherHomeScreen}
          options={{ tabBarIcon: ({ focused }) => tabIcon('Teacher', focused) }}
        />
      ) : null}
    </Tab.Navigator>
  );
}
