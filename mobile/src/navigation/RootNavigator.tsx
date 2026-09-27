import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Text, View, ActivityIndicator, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "../context/AuthContext";
import { hasAnyModule } from "../api/types";
import { colors } from "../theme/theme";
import { useDirectorSummary } from "../api/director";

import LoginScreen from "../screens/auth/LoginScreen";
import DashboardScreen from "../screens/dashboard/DashboardScreen";
import ApprovalsScreen from "../screens/approvals/ApprovalsScreen";
import FinanceScreen from "../screens/finance/FinanceScreen";
import BookingsHomeScreen from "../screens/bookings/BookingsHomeScreen";
import AccommodationScreen from "../screens/bookings/AccommodationScreen";
import FacilityBookingsScreen from "../screens/bookings/FacilityBookingsScreen";
import MovieRoomScreen from "../screens/bookings/MovieRoomScreen";
import BarRestaurantScreen from "../screens/bookings/BarRestaurantScreen";
import ProfileScreen from "../screens/profile/ProfileScreen";
import UserAccessScreen from "../screens/admin/UserAccessScreen";

const Tab = createBottomTabNavigator();
const BookingsStackNav = createNativeStackNavigator();
const ProfileStackNav = createNativeStackNavigator();
const RootStack = createNativeStackNavigator();

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return <Text style={{ fontSize: 11, fontWeight: focused ? "700" : "500", color: focused ? colors.primary : colors.textMuted }}>{label}</Text>;
}

type IconName = React.ComponentProps<typeof Ionicons>["name"];
function tabIcon(active: IconName, inactive: IconName) {
  return ({ focused, color, size }: { focused: boolean; color: string; size: number }) => (
    <Ionicons name={focused ? active : inactive} size={size ?? 22} color={color} />
  );
}

function BookingsStack() {
  return (
    <BookingsStackNav.Navigator screenOptions={{ headerShown: false }}>
      <BookingsStackNav.Screen name="BookingsHome" component={BookingsHomeScreen} />
      <BookingsStackNav.Screen name="AccommodationBookings" component={AccommodationScreen} />
      <BookingsStackNav.Screen name="FacilityBookings" component={FacilityBookingsScreen} />
      <BookingsStackNav.Screen name="MovieBookings" component={MovieRoomScreen} />
      <BookingsStackNav.Screen name="BarRestaurant" component={BarRestaurantScreen} />
    </BookingsStackNav.Navigator>
  );
}

function ProfileStack() {
  return (
    <ProfileStackNav.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStackNav.Screen name="ProfileHome" component={ProfileScreen} />
      <ProfileStackNav.Screen name="UserAccess" component={UserAccessScreen} />
    </ProfileStackNav.Navigator>
  );
}

function MainTabs() {
  const { user } = useAuth();
  const canApprove = hasAnyModule(user, ["purchasing", "internal-requisitions", "hr", "leave", "payroll", "finance"]);
  const canFinance = hasAnyModule(user, ["finance", "budgeting", "expenses"]);
  const canBook = hasAnyModule(user, ["accommodation", "facilities", "movie-room", "bar-restaurant"]);
  // Shares the Today briefing's cached query, so the badge stays in sync.
  const { data: summary } = useDirectorSummary(!!user);
  const pending = summary?.approvals.total ?? 0;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ tabBarLabel: ({ focused }) => <TabIcon label="Today" focused={focused} />, tabBarIcon: tabIcon("today", "today-outline") }}
      />
      {canApprove ? (
        <Tab.Screen
          name="Approvals"
          component={ApprovalsScreen}
          options={{
            tabBarLabel: ({ focused }) => <TabIcon label="Approvals" focused={focused} />, tabBarIcon: tabIcon("checkmark-done-circle", "checkmark-done-circle-outline"),
            tabBarBadge: pending > 0 ? (pending > 99 ? "99+" : pending) : undefined,
            tabBarBadgeStyle: { backgroundColor: colors.danger, color: "#fff", fontSize: 11 },
          }}
        />
      ) : null}
      {canFinance ? (
        <Tab.Screen
          name="Finance"
          component={FinanceScreen}
          options={{ tabBarLabel: ({ focused }) => <TabIcon label="Finance" focused={focused} />, tabBarIcon: tabIcon("wallet", "wallet-outline") }}
        />
      ) : null}
      {canBook ? (
        <Tab.Screen
          name="Bookings"
          component={BookingsStack}
          options={{ tabBarLabel: ({ focused }) => <TabIcon label="Bookings" focused={focused} />, tabBarIcon: tabIcon("bed", "bed-outline") }}
        />
      ) : null}
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        options={{ tabBarLabel: ({ focused }) => <TabIcon label="Profile" focused={focused} />, tabBarIcon: tabIcon("person-circle", "person-circle-outline") }}
      />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <RootStack.Screen name="Main" component={MainTabs} />
        ) : (
          <RootStack.Screen name="Login" component={LoginScreen} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
});
