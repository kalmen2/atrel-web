import React, { useMemo, useState } from 'react';
import { IconButton, Tooltip, Popover, Typography as MuiTypography } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { Box, Button, CircularProgress, Typography, Alert } from '@mui/material';
import CompactDataGrid from './ui/CompactDataGrid';
import { API_BASE } from './apiConfig.js';

export default function LateOrdersPage() {
	const [rows, setRows] = useState([]);
	const [itemRows, setItemRows] = useState([]);
	const [showNeedsOrderOnly, setShowNeedsOrderOnly] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [viewMode, setViewMode] = useState('items'); // 'orders' or 'items'

	const orderColumns = useMemo(
		() => [
			{ field: 'order_number', headerName: 'Order #', width: 180 },
			{ field: 'status', headerName: 'Status', width: 120 },
			{ field: 'latest_ship', headerName: 'Latest Ship', width: 170 },
			{ field: 'total_items', headerName: 'Items', width: 90 },
			{ field: 'item_numbers', headerName: 'Item Numbers', width: 240 }
		],
		[]
	);

	const itemColumns = useMemo(
		() => [
			{ field: 'item_number', headerName: 'Item Number', width: 180 },
			{ field: 'total_quantity', headerName: 'Total Quantity', width: 140 },
			{ field: 'on_purchase_order', headerName: 'On Purchase Order', width: 160 },
			{ field: 'on_hand', headerName: 'On Hand', width: 120 },
			
		],
		[]
	);

	const normalizeOrders = (data) => {
		if (Array.isArray(data)) return data;
		if (Array.isArray(data?.orders)) return data.orders;
		if (Array.isArray(data?.data)) return data.data;
		if (Array.isArray(data?.results)) return data.results;
		return [];
	};

	const fetchOrders = async () => {
		setLoading(true);
		setError('');
		try {
			const res = await fetch(`${API_BASE}/api/orders-due-by`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' }
			});
			const data = await res.json();
			if (!res.ok) {
				throw new Error(data?.error || 'Failed to fetch orders.');
			}
			const orders = normalizeOrders(data);
			// Add id field for DataGrid
			const rowsWithId = orders.map((order, index) => ({
				...order,
				id: order.id || order._id || order.order_id || `${order.order_number || 'order'}-${index}`,
			}));
			setRows(rowsWithId);
			// Handle item_totals
			let itemTotals = Array.isArray(data.item_totals)
				? data.item_totals.map((item, index) => ({
					...item,
					id: item.item_number || index
				}))
				: [];
			// Sort so warning rows appear first
			itemTotals = itemTotals.sort((a, b) => {
				const aWarn = typeof a.on_purchase_order === 'number' && typeof a.total_quantity === 'number' && a.on_purchase_order < a.total_quantity;
				const bWarn = typeof b.on_purchase_order === 'number' && typeof b.total_quantity === 'number' && b.on_purchase_order < b.total_quantity;
				if (aWarn === bWarn) return 0;
				return aWarn ? -1 : 1;
			});
			setItemRows(itemTotals);
		} catch (err) {
			setError(err.message || 'Failed to fetch orders.');
			setRows([]);
			setItemRows([]);
		} finally {
			setLoading(false);
		}
	};

	const [helpAnchorEl, setHelpAnchorEl] = useState(null);
	const handleHelpOpen = (event) => setHelpAnchorEl(event.currentTarget);
	const handleHelpClose = () => setHelpAnchorEl(null);
	const helpOpen = Boolean(helpAnchorEl);

	// Filtered item rows for 'items' view
	const filteredItemRows = showNeedsOrderOnly
		? itemRows.filter(row => {
				const total = typeof row.total_quantity === 'number' ? row.total_quantity : Number(row.total_quantity) || 0;
				const po = typeof row.on_purchase_order === 'number' ? row.on_purchase_order : Number(row.on_purchase_order) || 0;
				let hand = typeof row.on_hand === 'number' ? row.on_hand : Number(row.on_hand) || 0;
				if (hand < 0) hand = 0;
				return (po + hand) < total;
			})
		: itemRows;

	return (
		<Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'space-between' }}>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
					<Typography variant="h5" sx={{ fontWeight: 700, color: '#1976d2' }}>
						Late Orders
					</Typography>
					<Tooltip title="What is this page?">
						<IconButton size="small" onClick={handleHelpOpen}>
							<HelpOutlineIcon fontSize="small" />
						</IconButton>
					</Tooltip>
					<Popover
						open={helpOpen}
						anchorEl={helpAnchorEl}
						onClose={handleHelpClose}
						anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
						transformOrigin={{ vertical: 'top', horizontal: 'left' }}
						PaperProps={{ sx: { p: 2, maxWidth: 320 } }}
					>
						<MuiTypography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
							About Late Orders
						</MuiTypography>
						<MuiTypography variant="body2" gutterBottom>
							This page searches for orders with the <b>tag "kalmi"</b> and calculates the total items, including how much is currently on purchase order. Use this view to quickly identify and manage late orders requiring attention.
						</MuiTypography>
						<Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
							<Button onClick={handleHelpClose} size="small" variant="contained">Close</Button>
						</Box>
					</Popover>
				</Box>
							{/* Popover replaces Dialog for help */}
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
					<Button variant="contained" onClick={fetchOrders} disabled={loading}>
						Fetch
					</Button>
					{loading && <CircularProgress size={22} />}
					<Box sx={{ minWidth: 180 }}>
						<select
							value={viewMode}
							onChange={e => setViewMode(e.target.value)}
							style={{ padding: '8px', fontSize: '16px', borderRadius: '4px', border: '1px solid #ccc' }}
						>
							<option value="orders">See Orders</option>
							<option value="items">See Items</option>
						</select>
					</Box>
				</Box>
			</Box>
			{error && <Alert severity="error">{error}</Alert>}
			{viewMode === 'items' && (
				<Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
					<input
						type="checkbox"
						id="needsOrderOnly"
						checked={showNeedsOrderOnly}
						onChange={e => setShowNeedsOrderOnly(e.target.checked)}
						style={{ marginRight: 6 }}
					/>
					<label htmlFor="needsOrderOnly" style={{ fontSize: 14, userSelect: 'none', cursor: 'pointer' }}>
						Show only items that need to be ordered
					</label>
				</Box>
			)}
			<Box sx={{ flex: 1, minHeight: 0 }}>
				<CompactDataGrid
					rows={viewMode === 'orders' ? rows : filteredItemRows}
					columns={viewMode === 'orders' ? orderColumns : itemColumns}
					loading={loading}
					pageSizeOptions={[20, 50, 100]}
					initialPageSize={20}
					rowHeight={39}
					sx={{
						background: '#fff',
						fontSize: '13px',
						'& .item-warning-row': {
							backgroundColor: '#ffebee',
						},
					}}
					getRowClassName={viewMode === 'items' ? (params => {
						if (
							typeof params.row.on_purchase_order === 'number' &&
							typeof params.row.total_quantity === 'number' &&
							params.row.on_purchase_order < params.row.total_quantity
						) {
							return 'item-warning-row';
						}
						return '';
					}) : undefined}
				/>
			</Box>
		</Box>
	);
}
