import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await api.get<T>(url);
  return res.data;
}

// ---------- Accommodation ----------
export function useRooms() {
  return useQuery({ queryKey: ["rooms"], queryFn: () => fetchJson<any[]>("/api/rooms") });
}
export function useAccommodationBookings() {
  return useQuery({ queryKey: ["accommodation-bookings"], queryFn: () => fetchJson<any[]>("/api/accommodation-bookings") });
}
export function useCreateAccommodationBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, any>) => (await api.post("/api/accommodation-bookings", payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accommodation-bookings"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
    },
  });
}

// ---------- Facilities (Conference / Meeting rooms etc.) ----------
export function useFacilities() {
  return useQuery({ queryKey: ["facilities"], queryFn: () => fetchJson<any[]>("/api/facilities") });
}
export function useFacilityBookings() {
  return useQuery({ queryKey: ["facility-bookings"], queryFn: () => fetchJson<any[]>("/api/facility-bookings") });
}
export function useCreateFacilityBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, any>) => (await api.post("/api/facility-bookings", payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["facility-bookings"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
    },
  });
}

// ---------- Movie Room ----------
export function useMovieShows() {
  return useQuery({ queryKey: ["movie-shows"], queryFn: () => fetchJson<any[]>("/api/movie-shows") });
}
export function useMovieSeatBookings() {
  return useQuery({ queryKey: ["movie-seat-bookings"], queryFn: () => fetchJson<any[]>("/api/movie-seat-bookings") });
}
export function useCreateMovieSeatBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, any>) => (await api.post("/api/movie-seat-bookings", payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["movie-seat-bookings"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
    },
  });
}

// ---------- Bar & Restaurant (tables, orders, menu) ----------
export function useTables() {
  return useQuery({ queryKey: ["tables"], queryFn: () => fetchJson<any[]>("/api/tables") });
}
export function useOrders() {
  return useQuery({ queryKey: ["orders"], queryFn: () => fetchJson<any[]>("/api/orders") });
}
export function useMenuItems() {
  return useQuery({ queryKey: ["menu-items"], queryFn: () => fetchJson<any[]>("/api/menu-items") });
}
export function useOrderItems(orderId: number | null) {
  return useQuery({
    queryKey: ["order-items", orderId],
    queryFn: () => fetchJson<any[]>(`/api/orders/${orderId}/items`),
    enabled: !!orderId,
  });
}
export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, any>) => (await api.post("/api/orders", payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
    },
  });
}
export function useAddOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { orderId: number; menuItemId?: number; itemName: string; price: number; quantity: number; subtotal: number }) =>
      (await api.post("/api/order-items", payload)).data,
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["order-items", variables.orderId] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
    },
  });
}
