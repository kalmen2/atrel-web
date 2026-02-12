// anything complete in magento remove from purchase orders page

import React, { useEffect, useState } from 'react';
import { Box, IconButton, Popover, Select, MenuItem, Tooltip, Button, CircularProgress, Menu, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import CompactDataGrid from './ui/CompactDataGrid';
import { API_BASE } from './apiConfig.js';

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 });
  const [totalCount, setTotalCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [editingEtaId, setEditingEtaId] = useState(null);
  const [anchorEl, setAnchorEl] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkEtaValue, setBulkEtaValue] = useState('');
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [actionsAnchorEl, setActionsAnchorEl] = useState(null);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [etaDialogOpen, setEtaDialogOpen] = useState(false);
  const [rowMenuAnchor, setRowMenuAnchor] = useState(null);
  const [selectedRowId, setSelectedRowId] = useState(null);
  const statusStaleHours = {
    'awaiting payment': 48,
    'in packing': 72,
    default: 72
  };
  // Helper to reload orders (used after refresh and mutations)
  const reloadOrders = async (page = paginationModel.page, pageSize = paginationModel.pageSize) => {
    setLoading(true);
    let url = `${API_BASE}/api/purchase-orders`;
    const params = [];
    if (statusFilter) params.push(`status=${encodeURIComponent(statusFilter)}`);
    if (vendorFilter) params.push(`vendor=${encodeURIComponent(vendorFilter)}`);
    params.push(`page=${page + 1}`);
    params.push(`limit=${pageSize}`);
    if (params.length) url += `?${params.join('&')}`;
    const res = await fetch(url);
    const data = await res.json();
    setOrders((data.orders || []).map(o => ({ ...o, id: o._id })));
    setTotalCount(Number.isFinite(data.total) ? data.total : (data.orders || []).length);
    setLoading(false);
  };

    // Handler for the top-level refresh button
    const handleTopRefresh = async () => {
      setRefreshing(true);
      try {
        const res = await fetch(`${API_BASE}/api/refresh-purchase-orders`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'Refresh failed');
        } else {
          // Wait a moment for backend to update, then reload orders
          setTimeout(reloadOrders, 1200);
        }
      } catch {
        alert('Refresh failed');
      }
      setTimeout(() => setRefreshing(false), 1800);
    };

  useEffect(() => {
    setPaginationModel((prev) => ({ ...prev, page: 0 }));
  }, [statusFilter, vendorFilter]);

  // fetchOrders removed; logic is now handled in useEffect

  useEffect(() => {
    (async () => {
      await reloadOrders();
    })();
  }, [paginationModel.page, paginationModel.pageSize, statusFilter, vendorFilter]);

  const handleCalendarClick = (event, id) => {
    setEditingEtaId(id);
    setAnchorEl(event.currentTarget);
  };

  const handleEtaSave = async (id, date) => {
    await fetch(`${API_BASE}/api/purchase-orders/${id}/eta`, {
      method: date ? 'POST' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: date ? JSON.stringify({ eta: date }) : undefined
    });
    setEditingEtaId(null);
    setAnchorEl(null);
    await reloadOrders();
  };

  const handleStatusChange = async (id, status) => {
    await fetch(`${API_BASE}/api/purchase-orders/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    await reloadOrders();
  };

  const handleBulkUpdate = async (endpoint, value, clearFn) => {
    if (!value || selectedIds.length === 0) return;
    setBulkUpdating(true);
    await Promise.all(selectedIds.map(id => 
      fetch(`${API_BASE}/api/purchase-orders/${id}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(endpoint === 'status' ? { status: value } : { eta: value })
      })
    ));
    setBulkUpdating(false);
    clearFn('');
    setSelectedIds([]);
    await reloadOrders();
  };

  const handleBulkRemoveEta = async () => {
    if (selectedIds.length === 0) return;
    setBulkUpdating(true);
    await Promise.all(selectedIds.map(id => 
      fetch(`${API_BASE}/api/purchase-orders/${id}/eta`, {
        method: 'DELETE'
      })
    ));
    setBulkUpdating(false);
    setSelectedIds([]);
    await reloadOrders();
  };

  const handleDeletePO = async (id) => {
    const po = orders.find(o => o.id === id);
    if (po?.eta) {
      alert('Cannot delete PO: This purchase order has an ETA. Please remove ETA first.');
      return;
    }
    if (!confirm('Are you sure you want to delete this purchase order?')) return;
    
    await fetch(`${API_BASE}/api/purchase-orders/${id}`, {
      method: 'DELETE'
    });
    await reloadOrders();
  };

  const isStatusStale = (row) => {
    const status = row?.new_po_status || '';
    const lastUpdated = row?.status_last_updated;
    if (!status || !lastUpdated) return false;
    const hoursLimit = statusStaleHours[status] ?? statusStaleHours.default;
    return dayjs().diff(dayjs(lastUpdated), 'hour') > hoursLimit;
  };

  const columns = [
    { field: 'purchase_order_number', headerName: 'PO Number', width: 200 },
    { field: 'purchase_order_date', headerName: 'Purchase Order Date', width: 180 },
    {
      field: 'new_po_status',
      headerName: 'Status',
      width: 200,
      renderCell: (params) => {
        const etaSet = Boolean(params.row.eta);
        const currentStatus = params.row.new_po_status || params.value || '';
        if (etaSet) {
          return <span style={{ color: '#388e3c', fontWeight: 500 }}>ETA confirmed</span>;
        }
        return (
          <Select
            value={currentStatus}
            size="small"
            onChange={e => handleStatusChange(params.row.id, e.target.value)}
            sx={{ minWidth: 180, maxWidth: 180, height: 28, fontSize: '0.85rem', '& .MuiSelect-select': { py: '6px', fontSize: '0.85rem' } }}
            MenuProps={{ PaperProps: { sx: { maxHeight: 160, minWidth: 120 } } }}
          >
            {/* Show current status at the top if not one of the selectable options */}
            {!(currentStatus === 'awaiting payment' || currentStatus === 'in packing' || currentStatus === 'ETA confirmed') && currentStatus && (
              <MenuItem value={currentStatus} disabled sx={{ fontSize: '0.85rem', py: 0.5 }}>{currentStatus}</MenuItem>
            )}
            <MenuItem value="awaiting payment" sx={{ fontSize: '0.85rem', py: 0.5 }}>awaiting payment</MenuItem>
            <MenuItem value="in packing" sx={{ fontSize: '0.85rem', py: 0.5 }}>in packing</MenuItem>
            <Tooltip title="Add ETA in column" arrow placement="right">
              <span>
                <MenuItem value="ETA confirmed" disabled sx={{ fontSize: '0.85rem', py: 0.5, color: '#90caf9' }}>ETA confirmed</MenuItem>
              </span>
            </Tooltip>
          </Select>
        );
      }
    },
    {
      field: 'status_last_updated',
      headerName: 'Last Update',
      width: 160,
      renderCell: (params) => {
        const value = params.row?.status_last_updated;
        const handleRefresh = async () => {
          await fetch(`${API_BASE}/api/purchase-orders/${params.row.id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: params.row.new_po_status, refreshOnly: true })
          });
          await reloadOrders();
        };
        return (
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ marginRight: value ? 8 : 0 }}>
              {value ? dayjs(value).format('YYYY-MM-DD HH:mm') : <span style={{ color: '#aaa' }}>—</span>}
            </span>
            {value && (
              <Tooltip title="Refresh Last Update">
                <IconButton size="small" onClick={handleRefresh}>
                  <span role="img" aria-label="refresh">🔄</span>
                </IconButton>
              </Tooltip>
            )}
          </Box>
        );
      }
    },
    { field: 'supplier_name', headerName: 'Vendor', width: 180 },
    {
      field: 'eta',
      headerName: 'ETA',
      width: 120,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <span style={{ color: params.value ? undefined : '#aaa', flex: 1 }}>
            {params.value ? dayjs(params.value).format('YYYY-MM-DD') : 'Enter ETA'}
          </span>
          <IconButton size="small" sx={{ ml: 1 }} onClick={e => handleCalendarClick(e, params.row.id)}>
            <CalendarMonthIcon fontSize="small" />
          </IconButton>
          {editingEtaId === params.row.id && (
            <Popover
              open={Boolean(anchorEl)}
              anchorEl={anchorEl}
              onClose={() => { setEditingEtaId(null); setAnchorEl(null); }}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <Box sx={{ p: 2, minWidth: 220 }}>
                <DatePicker
                  value={params.value ? dayjs(params.value) : null}
                  onChange={date => date && handleEtaSave(params.row.id, date.format('YYYY-MM-DD'))}
                  slotProps={{ textField: { size: 'small', inputProps: { readOnly: true } } }}
                />
                {params.value && (
                  <Box sx={{ mt: 2, textAlign: 'right' }}>
                    <button
                      style={{ color: '#d32f2f', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}
                      onClick={() => handleEtaSave(params.row.id, null)}
                    >
                      Delete
                    </button>
                  </Box>
                )}
              </Box>
            </Popover>
          )}
        </Box>
      )
    },
    {
      field: 'actions',
      headerName: '',
      width: 60,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <IconButton
          size="small"
          onClick={(e) => {
            setRowMenuAnchor(e.currentTarget);
            setSelectedRowId(params.row.id);
          }}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      )
    },
  ];

  // Get unique statuses and vendors for filter dropdowns
  const statusOptions = Array.from(new Set(orders.map(o => o.new_po_status).filter(Boolean)));
  // Build vendorOptions with PO count
  const vendorCounts = orders.reduce((acc, o) => {
    if (o.supplier_name) {
      acc[o.supplier_name] = (acc[o.supplier_name] || 0) + 1;
    }
    return acc;
  }, {});
  const vendorOptions = Object.keys(vendorCounts).sort((a, b) => a.localeCompare(b));

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            displayEmpty
            size="small"
            sx={{ minWidth: 160 }}
          >
            <MenuItem value=""><em>All Statuses</em></MenuItem>
            {statusOptions.map(s => (
              <MenuItem key={s} value={s}>{s}</MenuItem>
            ))}
          </Select>
          <Select
            value={vendorFilter}
            onChange={e => setVendorFilter(e.target.value)}
            displayEmpty
            size="small"
            sx={{ minWidth: 160 }}
          >
            <MenuItem value=""><em>All Vendors</em></MenuItem>
            {vendorOptions.map(v => (
              <MenuItem key={v} value={v}>
                {v} <span style={{ color: '#888', fontSize: 13, marginLeft: 6 }}>({vendorCounts[v]})</span>
              </MenuItem>
            ))}
          </Select>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {selectedIds.length > 0 && (
            <Button
              variant="outlined"
              size="small"
              onClick={(e) => setActionsAnchorEl(e.currentTarget)}
              endIcon={<ArrowDropDownIcon />}
              sx={{ minWidth: 130, textTransform: 'none' }}
            >
              Actions ({selectedIds.length})
            </Button>
          )}
          <Button
          variant="contained"
          color="primary"
          size="small"
          onClick={handleTopRefresh}
          disabled={refreshing}
          startIcon={refreshing ? <CircularProgress size={16} color="inherit" /> : <span role="img" aria-label="refresh">🔄</span>}
          sx={{ fontWeight: 600, minWidth: 90, boxShadow: 'none', textTransform: 'none' }}
        >
          Refresh
        </Button>
        </Box>
      </Box>

      <Menu
        anchorEl={actionsAnchorEl}
        open={Boolean(actionsAnchorEl)}
        onClose={() => setActionsAnchorEl(null)}
      >
        <MenuItem onClick={() => {
          setActionsAnchorEl(null);
          const selectedOrders = orders.filter(o => selectedIds.includes(o.id));
          const hasEta = selectedOrders.some(o => o.eta);
          if (hasEta) {
            alert('Cannot update status: One or more selected purchase orders have an ETA. Please remove ETA first.');
          } else {
            setStatusDialogOpen(true);
          }
        }}>
          Update Status
        </MenuItem>
        <MenuItem onClick={() => { setActionsAnchorEl(null); setEtaDialogOpen(true); }}>
          Update ETA
        </MenuItem>
        <MenuItem onClick={async () => { setActionsAnchorEl(null); await handleBulkRemoveEta(); }}>
          Remove ETA
        </MenuItem>
      </Menu>

      <Menu
        anchorEl={rowMenuAnchor}
        open={Boolean(rowMenuAnchor)}
        onClose={() => { setRowMenuAnchor(null); setSelectedRowId(null); }}
      >
        <MenuItem onClick={async () => {
          setRowMenuAnchor(null);
          if (selectedRowId) {
            await handleDeletePO(selectedRowId);
            setSelectedRowId(null);
          }
        }}>
          Delete PO
        </MenuItem>
      </Menu>

      <Dialog open={statusDialogOpen} onClose={() => setStatusDialogOpen(false)} maxWidth="xs">
        <DialogTitle>Update Status ({selectedIds.length})</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} displayEmpty fullWidth size="small">
            <MenuItem value=""><em>Select Status</em></MenuItem>
            <MenuItem value="awaiting payment">awaiting payment</MenuItem>
            <MenuItem value="in packing">in packing</MenuItem>
          </Select>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatusDialogOpen(false)}>Cancel</Button>
          <Button onClick={async () => { await handleBulkUpdate('status', bulkStatus, setBulkStatus); setStatusDialogOpen(false); }} disabled={!bulkStatus || bulkUpdating} variant="contained">Update</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={etaDialogOpen} onClose={() => setEtaDialogOpen(false)} maxWidth="xs">
        <DialogTitle>Update ETA ({selectedIds.length})</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <DatePicker value={bulkEtaValue ? dayjs(bulkEtaValue) : null} onChange={date => date && setBulkEtaValue(date.format('YYYY-MM-DD'))} slotProps={{ textField: { size: 'small', fullWidth: true, inputProps: { readOnly: true } } }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEtaDialogOpen(false)}>Cancel</Button>
          <Button onClick={async () => { await handleBulkUpdate('eta', bulkEtaValue, setBulkEtaValue); setEtaDialogOpen(false); }} disabled={!bulkEtaValue || bulkUpdating} variant="contained">Update</Button>
        </DialogActions>
      </Dialog>

      <CompactDataGrid
        rows={orders}
        columns={columns}
        loading={loading}
        pagination
        checkboxSelection
        paginationMode="server"
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        rowSelectionModel={selectedIds}
        onRowSelectionModelChange={setSelectedIds}
        rowCount={totalCount}
        pageSizeOptions={[20, 50, 100]}
        initialPageSize={paginationModel.pageSize}
        getRowClassName={(params) => (isStatusStale(params.row) ? 'po-stale' : '')}
        sx={{
          flex: 1,
          minHeight: 0,
          '& .po-stale': { bgcolor: '#ec4e66' },
          '& .po-stale:hover': { bgcolor: '#ec4e66' }
        }}
      />
    </Box>
  );
}
