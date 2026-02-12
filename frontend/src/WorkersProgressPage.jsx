import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, MenuItem, Select, FormControl, InputLabel, Paper } from '@mui/material';
import { API_BASE } from './apiConfig.js';

export default function WorkersProgressPage() {
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    // Fetch users from backend
    fetch(`${API_BASE}/api/users`)
    

      .then(res => res.json())
      .then(data => {
        setUsers(data.users || []);
        console.log('Fetched users:', data.users);
      });
    // Fetch all orders from backend (no pagination, for stats)
    fetch(`${API_BASE}/api/orders?all=true`)
      .then(res => res.json())
      .then(data => {
        setOrders(data.orders || []);
        console.log('Fetched all orders:', data.orders);
      });
  }, []);

  const selectedUserObj = useMemo(() => {
    if (!selectedUser || users.length === 0) return null;
    return users.find(u => u._id === selectedUser) || null;
  }, [selectedUser, users]);

  const ordersPacked = useMemo(() => {
    if (!selectedUserObj || orders.length === 0) return null;
    return orders.filter(order => order.packed_by === selectedUserObj.name).length;
  }, [orders, selectedUserObj]);

  return (
    <Box sx={{ p: 3, maxWidth: 600, mx: 'auto', mt: 4 }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h5" gutterBottom>
          See Workers Progress
        </Typography>
        <FormControl fullWidth sx={{ mb: 3 }}>
          <InputLabel id="user-select-label">Select Worker</InputLabel>
          <Select
            labelId="user-select-label"
            value={selectedUser}
            label="Select Worker"
            onChange={e => setSelectedUser(e.target.value)}
          >
            {users.map(user => (
              <MenuItem key={user._id} value={user._id}>{user.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        {ordersPacked !== null && selectedUserObj && (
          <Box>
            <Typography variant="subtitle1" sx={{ mt: 2 }}>
              <b>{selectedUserObj.name}</b> ({selectedUserObj.username})
            </Typography>
            <Typography sx={{ mt: 1 }}>
              Orders packed: <b>{ordersPacked}</b>
            </Typography>
            {/* Add more details as needed */}
          </Box>
        )}
      </Paper>
    </Box>
  );
}
