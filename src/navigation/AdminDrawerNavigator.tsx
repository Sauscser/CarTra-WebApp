import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { Platform, useWindowDimensions } from 'react-native';
import HomeTabsNavigator from './HomeTabsNavigator';
import NationalOfficeScreen from '../screens/National';
import RegionalHomeScreen from '../screens/Regional/RegionalHomeScreen';
import CountyHomeScreen from '../screens/County/CountyHomeScreen';
import SubCountyHomeScreen from '../screens/SubCounty/SubCountyHomeScreen';
import TertiaryHomeScreen from '../screens/Tertiary/TertiaryHomeScreen';
import AccountScreen from '../screens/Account/AccountScreen';
import { DrawerRouteName, TabRouteName } from '../types/navigation';

const Drawer = createDrawerNavigator();

type AdminDrawerNavigatorProps = {
  username?: string;
  onSignOut: () => Promise<void>;
  signingOut: boolean;
  drawerRoutes: DrawerRouteName[];
  tabRoutes: TabRouteName[];
};

export default function AdminDrawerNavigator({
  username,
  onSignOut,
  signingOut,
  drawerRoutes,
  tabRoutes,
}: AdminDrawerNavigatorProps) {
  const { width } = useWindowDimensions();
  const desktopWeb = Platform.OS === 'web' && width >= 1024;

  return (
    <Drawer.Navigator
      initialRouteName="Home"
      screenOptions={{
        drawerType: desktopWeb ? 'permanent' : 'front',
        drawerStyle: desktopWeb ? { width: 264, backgroundColor: '#f8fafc' } : undefined,
        headerTintColor: '#111827',
        headerStyle: { backgroundColor: '#f8fafc' },
        drawerActiveTintColor: '#1d4ed8',
        drawerInactiveTintColor: '#374151',
        sceneStyle: { backgroundColor: '#f3f4f6' },
      }}
    >
      <Drawer.Screen name="Home" options={{ title: 'Home' }}>
        {() => <HomeTabsNavigator tabRoutes={tabRoutes} />}
      </Drawer.Screen>

      {drawerRoutes.includes('National Office') ? <Drawer.Screen name="National Office" component={NationalOfficeScreen} /> : null}
      {drawerRoutes.includes('Regional Office') ? <Drawer.Screen name="Regional Office" component={RegionalHomeScreen} /> : null}
      {drawerRoutes.includes('County Office') ? <Drawer.Screen name="County Office" component={CountyHomeScreen} /> : null}
      {drawerRoutes.includes('Sub-county Office') ? <Drawer.Screen name="Sub-county Office" component={SubCountyHomeScreen} /> : null}
      {drawerRoutes.includes('Tertiary Office') ? <Drawer.Screen name="Tertiary Office" component={TertiaryHomeScreen} /> : null}

      <Drawer.Screen name="Account">
        {() => <AccountScreen username={username} onSignOut={onSignOut} loading={signingOut} />}
      </Drawer.Screen>
    </Drawer.Navigator>
  );
}
