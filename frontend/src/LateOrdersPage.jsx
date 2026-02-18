import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { IconButton, Tooltip, Popover, Typography as MuiTypography } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { Box, Button, CircularProgress, Typography, Alert } from '@mui/material';
import CompactDataGrid from './ui/CompactDataGrid';
import { API_BASE } from './apiConfig.js';

export default function LateOrdersPage() {
	const [rows, setRows] = useState([]);
	const [itemRows, setItemRows] = useState([]);
	const [summary, setSummary] = useState(null);
	const [reportDate, setReportDate] = useState(null);
	const [showOnHandOnly, setShowOnHandOnly] = useState(false);
	const [showItemsShortOnly, setShowItemsShortOnly] = useState(false);
	const [loading, setLoading] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [error, setError] = useState('');
	const [statusMessage, setStatusMessage] = useState('');
	const [detailsAnchorEl, setDetailsAnchorEl] = useState(null);
	const [detailsRows, setDetailsRows] = useState([]);
	const [detailsItemNumber, setDetailsItemNumber] = useState('');

	const handleDetailsClose = () => {
		setDetailsAnchorEl(null);
		setDetailsRows([]);
		setDetailsItemNumber('');
	};
	const detailsOpen = Boolean(detailsAnchorEl);

	const itemColumns = useMemo(
		() => [
			{ field: 'item_number', headerName: 'Item Number', width: 180 },
			{ field: 'units_due', headerName: 'Units Due', width: 120 },
			{ field: 'on_hand', headerName: 'On Hand', width: 120 },
			{
				field: 'awaiting_goflow',
				headerName: 'Awaiting GoFlow',
				width: 160,
				align: 'left',
				renderCell: (params) => {
					const value = Number(params.value || 0);
					const details = params.row?.awaiting_goflow_details || [];
					if (value > 0 && details.length > 0) {
						return (
							<Box
								component="span"
								onClick={(event) => {
									setDetailsAnchorEl(event.currentTarget);
									setDetailsRows(details);
									setDetailsItemNumber(params.row?.item_number || '');
								}}
								sx={{
									cursor: 'pointer',
									color: '#1976d2',
									'&:hover': { color: '#1565c0' }
								}}
							>
								{value}
							</Box>
						);
					}
					return value;
				}
			},
			{
				field: 'awaiting_fba',
				headerName: 'Awaiting FBA',
				width: 140,
				align: 'left',
				renderCell: (params) => {
					const value = Number(params.value || 0);
					const details = params.row?.awaiting_fba_details || [];
					if (value > 0 && details.length > 0) {
						return (
							<Box
								component="span"
								onClick={(event) => {
									setDetailsAnchorEl(event.currentTarget);
									setDetailsRows(details);
									setDetailsItemNumber(params.row?.item_number || '');
								}}
								sx={{
									cursor: 'pointer',
									color: '#1976d2',
									'&:hover': { color: '#1565c0' }
								}}
							>
								{value}
							</Box>
						);
					}
					return value;
				}
			},
			{ field: 'awaiting_total', headerName: 'Awaiting Total', width: 140 }
			
		],
		[]
	);

	const fetchOrders = useCallback(async () => {
		setLoading(true);
		setError('');
		setStatusMessage('');
		setRows([]);
		setItemRows([]);
		setSummary(null);
		setReportDate(null);
		try {
			const statusRes = await fetch(`${API_BASE}/api/late-orders-report/status`);
			if (statusRes.ok) {
				const statusData = await statusRes.json();
				if (statusData?.running) {
					setStatusMessage('Report is currently being generated. Please wait...');
					return;
				}
			}
			const res = await fetch(`${API_BASE}/api/late-orders-report`);
			const data = await res.json();
			if (!res.ok) {
				throw new Error(data?.error || 'Failed to fetch orders.');
			}
			const report = data?.report === null ? null : (data?.report || data);
			if (!report) {
				return;
			}
			setSummary(report.summary || null);
			setReportDate(report.report_date || null);
			
			let itemTotals = Array.isArray(report.items)
				? report.items.map((item, index) => {
					const awaitingGoflow = Number(item.awaiting_goflow || 0);
					const awaitingFba = Number(item.awaiting_fba || 0);
					return {
						...item,
						awaiting_total: awaitingGoflow + awaitingFba,
						id: item.item_number || index
					};
				})
				: [];
			// Sort so warning rows appear first
			itemTotals = itemTotals.sort((a, b) => {
				const aDue = Number(a.units_due || 0);
				const bDue = Number(b.units_due || 0);
				const aAvail = Number(a.on_hand || 0) + Number(a.awaiting_total || 0);
				const bAvail = Number(b.on_hand || 0) + Number(b.awaiting_total || 0);
				const aWarn = aAvail < aDue;
				const bWarn = bAvail < bDue;
				if (aWarn === bWarn) return 0;
				return aWarn ? -1 : 1;
			});
			setItemRows(itemTotals);
		} catch (err) {
			setError(err.message || 'Failed to fetch orders.');
		} finally {
			setLoading(false);
		}
	}, []);

	const generateReport = useCallback(async () => {
		setGenerating(true);
		setError('');
		setStatusMessage('');
		try {
			const res = await fetch(`${API_BASE}/api/refresh-late-orders-report`, { method: 'POST' });
			const data = await res.json();
			if (!res.ok) {
				const message = data?.error || 'Failed to generate report.';
				setStatusMessage(message);
				return;
			}
			setStatusMessage('Report is currently being generated. Please wait...');
			setTimeout(() => {
				fetchOrders();
			}, 3000);
		} catch (err) {
			setError(err.message || 'Failed to generate report.');
		} finally {
			setGenerating(false);
		}
	}, [fetchOrders]);

	useEffect(() => {
		fetchOrders();
	}, [fetchOrders]);

	const [helpAnchorEl, setHelpAnchorEl] = useState(null);
	const handleHelpOpen = (event) => setHelpAnchorEl(event.currentTarget);
	const handleHelpClose = () => setHelpAnchorEl(null);
	const helpOpen = Boolean(helpAnchorEl);

	// Filtered item rows for 'items' view
	const filteredItemRows = itemRows.filter(row => {
		if (showOnHandOnly) {
			let hand = Number(row.on_hand || 0);
			if (hand < 0) hand = 0;
			if (hand <= 0) return false;
		}
		if (showItemsShortOnly) {
			const total = Number(row.units_due || 0);
			let hand = Number(row.on_hand || 0);
			if (hand < 0) hand = 0;
			const available = hand + Number(row.awaiting_total || 0);
			if (available >= total) return false;
		}
		return true;
	});

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
					<Button variant="outlined" onClick={generateReport} disabled={generating}>
						{generating ? 'Generating…' : 'Generate Report'}
					</Button>
					{loading && <CircularProgress size={22} />}
				</Box>
			</Box>
			{error && <Alert severity="error">{error}</Alert>}
			{statusMessage && <Alert severity="info">{statusMessage}</Alert>}
			{summary && (
				<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, bgcolor: '#f8fafc', p: 2, borderRadius: 2, border: '1px solid #e2e8f0' }}>
					<Box>
						<Typography variant="subtitle2" color="text.secondary">Report Date</Typography>
						<Typography variant="body1" sx={{ fontWeight: 600 }}>
							{reportDate ? new Date(reportDate).toLocaleString() : 'N/A'}
						</Typography>
					</Box>
					<Box>
						<Typography variant="subtitle2" color="text.secondary">Total Due Orders</Typography>
						<Typography variant="body1" sx={{ fontWeight: 600 }}>{summary.total_due_orders_amount}</Typography>
					</Box>
					<Box>
						<Typography variant="subtitle2" color="text.secondary">Total Items Due</Typography>
						<Typography variant="body1" sx={{ fontWeight: 600 }}>{summary.total_items_due}</Typography>
					</Box>
					<Box>
						<Typography variant="subtitle2" color="text.secondary">Total Units Due</Typography>
						<Typography variant="body1" sx={{ fontWeight: 600 }}>{summary.total_units_due}</Typography>
					</Box>
					<Box
						role="button"
						onClick={() => {
							setShowOnHandOnly(prev => {
								const next = !prev;
								if (next) setShowItemsShortOnly(false);
								return next;
							});
						}}
						sx={{
							cursor: 'pointer',
							borderRadius: 1,
							px: 1,
							py: 0.5,
							bgcolor: showOnHandOnly ? '#e3f2fd' : 'transparent',
							'&:hover': { bgcolor: '#e3f2fd' }
						}}
					>
						<Typography variant="subtitle2" color="text.secondary">Total On Hand</Typography>
						<Typography variant="body1" sx={{ fontWeight: 600 }}>{summary.total_on_hand}</Typography>
					</Box>
					<Box>
						{/* <Typography variant="subtitle2" color="text.secondary">Total Awaiting</Typography> */}
						<Typography variant="body1" sx={{ fontWeight: 600 }}>{summary.total_awaiting}</Typography>
					</Box>
					<Box
						role="button"
						onClick={() => {
							setShowItemsShortOnly(prev => {
								const next = !prev;
								if (next) setShowOnHandOnly(false);
								return next;
							});
						}}
						sx={{
							cursor: 'pointer',
							borderRadius: 1,
							px: 1,
							py: 0.5,
							bgcolor: showItemsShortOnly ? '#e3f2fd' : 'transparent',
							'&:hover': { bgcolor: '#e3f2fd' }
						}}
					>
						<Typography variant="subtitle2" color="text.secondary">Items Short</Typography>
						<Typography variant="body1" sx={{ fontWeight: 600 }}>{summary.total_items_short}</Typography>
						{/* <Typography variant="caption" color="text.secondary">Click to filter</Typography> */}
					</Box>
				</Box>
			)}
			<Box sx={{ mb: 1 }} />
			<Box sx={{ flex: 1, minHeight: 0 }}>
				<CompactDataGrid
					rows={filteredItemRows}
					columns={itemColumns}
					loading={loading}
					pageSizeOptions={[20, 50, 100]}
					initialPageSize={20}
					rowHeight={39}
					sx={{
						background: '#fff',
						fontSize: '13px'
					}}
				/>
			</Box>
			<Popover
				open={detailsOpen}
				anchorEl={detailsAnchorEl}
				onClose={handleDetailsClose}
				anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
				transformOrigin={{ vertical: 'top', horizontal: 'left' }}
				PaperProps={{ sx: { p: 2, minWidth: 260 } }}
			>
				<Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
					Awaiting GoFlow POs{detailsItemNumber ? ` • ${detailsItemNumber}` : ''}
				</Typography>
				{detailsRows.length === 0 ? (
					<Typography variant="body2">No PO details.</Typography>
				) : (
					<Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
						{detailsRows.map((row) => (
							<Box key={`${row.purchase_order_number}-${row.qty}`} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
								<Typography variant="body2">{row.purchase_order_number}</Typography>
								<Typography variant="body2" sx={{ fontWeight: 600 }}>{row.qty}</Typography>
							</Box>
						))}
					</Box>
				)}
			</Popover>
		</Box>
	);
}
