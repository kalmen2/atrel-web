import React, { useEffect, useState } from 'react';
import { Box, FormControl, InputLabel, Select, MenuItem, OutlinedInput, Checkbox, ListItemText, Stack, TextField, InputAdornment, IconButton, Button } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CompactDataGrid from './ui/CompactDataGrid';
import { API_BASE } from './apiConfig.js';

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const handleOrdersRefresh = async () => {
    setRefreshing(true);
    setRefreshError('');
    try {
      const res = await fetch(`${API_BASE}/api/refresh-orders`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) setRefreshError(data.error || 'Refresh failed');
      else setTimeout(fetchOrders, 1200);
    } catch { setRefreshError('Refresh failed'); }
    setTimeout(() => setRefreshing(false), 1800);
  };
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 });
  // Filter states
  const [packedBy, setPackedBy] = useState('');
  const [sentBy, setSentBy] = useState('');
  const [status, setStatus] = useState([]);
  const [allWorkers, setAllWorkers] = useState([]);
  const allStatuses = ['shipped', 'packed', 'sent_out'];
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  // Store previous filters to restore after clearing search
  const [prevFilters, setPrevFilters] = useState(null);

  // Debug: log pageSize and page changes
  useEffect(() => {
    console.log('Current pageSize:', paginationModel.pageSize, 'Current page:', paginationModel.page);
  }, [paginationModel]);

  // Fetch all workers and statuses for filter dropdowns
  useEffect(() => {
    fetch(`${API_BASE}/api/users`)
      .then(res => res.json())
      .then(data => setAllWorkers(data.users ? data.users.map(u => ({ username: u.username, name: u.name })) : []));
  }, []);

  const fetchOrders = async () => {
    setLoading(true);
    let params;
    if (search) {
      // When searching, ignore filters and fetch a large page from backend
      params = new URLSearchParams({
        page: 1,
        limit: 100,
        search: search
      });
    } else {
      params = new URLSearchParams({
        page: paginationModel.page + 1,
        limit: paginationModel.pageSize,
      });
      if (packedBy) params.append('packed_by', packedBy);
      if (sentBy) params.append('sent_out_by', sentBy);
      if (status.length > 0) params.append('status', status.join(','));
    }
    console.log('Fetching orders with params:', params.toString());
    const res = await fetch(`${API_BASE}/api/orders?${params.toString()}`);
    const data = await res.json();
    let orders = (data.orders || []).map((order, idx) => ({ id: order._id || idx, ...order }));
    // If searching, filter on frontend to only show exact matches for order_number or tracking_number
    if (search) {
      const searchVal = search.toLowerCase();
      orders = orders.filter(order => {
        const orderNum = String(order.order_number || '').toLowerCase();
        const trackingNum = String(order.tracking_number || '').toLowerCase();
        return orderNum.includes(searchVal) || trackingNum.includes(searchVal);
      });
      setOrders(orders);
      setTotal(orders.length);
    } else {
      setOrders(orders);
      setTotal(data.total || orders.length);
    }
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      await fetchOrders();
    })();
    // eslint-disable-next-line
  }, [paginationModel, packedBy, sentBy, status, search]);

  // When search is set, clear filters and store previous
  useEffect(() => {
    if (search) {
      if (!prevFilters && (packedBy || sentBy || status.length > 0)) {
        // Batch all state updates in a microtask to avoid cascading renders
        Promise.resolve().then(() => {
          setPrevFilters({ packedBy, sentBy, status });
          setPackedBy('');
          setSentBy('');
          setStatus([]);
        });
      }
    } else if (prevFilters) {
      Promise.resolve().then(() => {
        setPackedBy(prevFilters.packedBy);
        setSentBy(prevFilters.sentBy);
        setStatus(prevFilters.status);
        setPrevFilters(null);
      });
    }
    // eslint-disable-next-line
  }, [search]);

  const columns = [
    // { field: 'id', headerName: 'ID', width: 220 },
    { field: 'order_number', headerName: 'Order Number', width: 200 },
    { field: 'status', headerName: 'Status', width: 120 },
    {
      field: 'carrier_tracking',
      headerName: 'Carrier Tracking',
      width: 140,
      valueGetter: (params) => {
        const carrier = params?.row?.carrier?.toLowerCase?.() || '';
        const trackingNumber = params?.row?.tracking_number || '';
        if (carrier === 'asendia' || trackingNumber.startsWith('TBA')) return 'Unavailable';
        return params?.row?.tracking?.status || params?.row?.tracking_status || '';
      },
      renderCell: (params) => {
        const carrier = params?.row?.carrier?.toLowerCase?.() || '';
        const trackingNumber = params?.row?.tracking_number || '';
        const unavailable = carrier === 'asendia' || trackingNumber.startsWith('TBA');
        return (
          <span style={{ fontWeight: 500 }}>
            {unavailable ? 'Unavailable' : (params?.row?.tracking?.status || params?.row?.tracking_status || '—')}
          </span>
        );
      },
    },
    { field: 'tracking_number', headerName: 'Tracking Number', width: 200 },
    { field: 'shipped_at', headerName: 'Shipped Time', width: 180 },
    { field: 'packed_by', headerName: 'Packed By', width: 160 },
    { field: 'packed_time', headerName: 'Packed Time', width: 180 },
    { field: 'sent_out_by', headerName: 'Sent By', width: 160 },
    { field: 'sent_out_time', headerName: 'Sent Time', width: 180 },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0, p: 2 }}>
      {/* Filters + Search Bar in one row */}
      <Box sx={{ position: 'relative', mb: 2 }}>
        <Box sx={{ position: 'absolute', top: 0, right: 0, zIndex: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button variant="contained" size="small" onClick={handleOrdersRefresh} disabled={refreshing} sx={{ minWidth: 90, fontWeight: 600 }}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
          {refreshError && <span style={{ color: '#d32f2f', fontSize: 13, marginLeft: 8 }}>{refreshError}</span>}
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
        <FormControl sx={{ minWidth: 100, maxWidth: 120, '& .MuiInputBase-root': { height: 32, fontSize: '0.85rem', padding: 0 }, '& .MuiInputLabel-root': { fontSize: '0.85rem', top: '-4px' } }} size="small">
          <InputLabel>Packed By</InputLabel>
          <Select
            value={packedBy}
            label="Packed By"
            onChange={e => setPackedBy(e.target.value)}
            displayEmpty
            disabled={!!search}
          >
            <MenuItem value=""><em>All</em></MenuItem>
            {allWorkers.map(w => (
              <MenuItem key={w.name} value={w.name}>{w.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl sx={{ minWidth: 100, maxWidth: 120, '& .MuiInputBase-root': { height: 32, fontSize: '0.85rem', padding: 0 }, '& .MuiInputLabel-root': { fontSize: '0.85rem', top: '-4px' } }} size="small">
          <InputLabel>Sent By</InputLabel>
          <Select
            value={sentBy}
            label="Sent By"
            onChange={e => setSentBy(e.target.value)}
            displayEmpty
            disabled={!!search}
          >
            <MenuItem value=""><em>All</em></MenuItem>
            {allWorkers.map(w => (
              <MenuItem key={w.name} value={w.name}>{w.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl sx={{ minWidth: 120, maxWidth: 140, '& .MuiInputBase-root': { height: 32, fontSize: '0.85rem', padding: 0 }, '& .MuiInputLabel-root': { fontSize: '0.85rem', top: '-4px' } }} size="small">
          <InputLabel>Status</InputLabel>
          <Select
            multiple
            value={status}
            onChange={e => setStatus(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
            input={<OutlinedInput label="Status" />}
            renderValue={selected => selected.join(', ')}
            disabled={!!search}
          >
            {allStatuses.map(s => (
              <MenuItem key={s} value={s}>
                <Checkbox checked={status.indexOf(s) > -1} />
                <ListItemText primary={s} />
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          size="small"
          variant="outlined"
          placeholder="Search order number or tracking"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') setSearch(searchInput);
          }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton onClick={() => setSearch(searchInput)}>
                  <SearchIcon />
                </IconButton>
              </InputAdornment>
            ),
          }}
          sx={{ minWidth: 320 }}
          disabled={loading}
        />
        </Stack>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', p: 2 }}>
        <CompactDataGrid
          rows={orders}
          columns={columns}
          rowCount={total}
          pagination
          paginationMode="server"
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          loading={loading}
          pageSizeOptions={[20, 50, 100]}
          initialPageSize={paginationModel.pageSize}
          sx={{ flex: 1, minHeight: 0 }}
        />
      </Box>
    </Box>
  );
}
