import React, { useEffect, useState } from 'react';
import { Box, TextField, Button, Popover, Typography, List, ListItem, ListItemText, IconButton, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import dayjs from 'dayjs';
import { API_BASE } from './apiConfig.js';

export default function DeliveriesPage() {
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [popoverAnchor, setPopoverAnchor] = useState(null);
  const [popoverPOs, setPopoverPOs] = useState([]);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState(null);

  const fetchDeliveries = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/deliveries`);
      const data = await res.json();
      console.log('[deliveries] fetch', {
        status: res.status,
        count: (data.deliveries || []).length,
        sample: (data.deliveries || []).slice(0, 3).map(d => ({
          supplier_name: d.supplier_name,
          eta: d.eta,
          pallet_amount: d.pallet_amount,
          box_amount: d.box_amount
        }))
      });
      const deliveriesArr = (data.deliveries || []).map(d => ({
        ...d,
        id: d._id,
        formattedEta: dayjs(d.eta).format('YYYY-MM-DD'),
      })).sort((a, b) => dayjs(a.eta).diff(dayjs(b.eta)));
      setDeliveries(deliveriesArr);
    } catch (err) {
      console.error('Error fetching deliveries:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      await fetchDeliveries();
    })();
  }, []);

  const handleEditCellChange = async (params) => {
    console.log('[deliveries] edit', params);
    setDeliveries((prev) => prev.map(row =>
      row.id === params.id ? { ...row, [params.field]: params.value } : row
    ));
    const row = deliveries.find(r => r.id === params.id);
    if (row) {
      console.log('[deliveries] update payload', {
        supplier_name: row.supplier_name,
        eta: row.eta,
        field: params.field,
        value: params.value
      });
      await fetch(`${API_BASE}/api/delivery-amounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delivery_id: row._id || row.id,
          supplier_name: row.supplier_name,
          eta: row.eta,
          pallet_amount: params.field === 'pallet_amount' ? params.value : row.pallet_amount,
          box_amount: params.field === 'box_amount' ? params.value : row.box_amount,
        })
      });
      await fetchDeliveries();
    }
  };

  const handleCompleteDelivery = async () => {
    if (!selectedDelivery?.po_numbers?.length) {
      setCompleteDialogOpen(false);
      return;
    }
    await fetch(`${API_BASE}/api/deliveries/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ po_numbers: selectedDelivery.po_numbers })
    });
    setCompleteDialogOpen(false);
    setSelectedDelivery(null);
    await fetchDeliveries();
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, p: 2, background: 'linear-gradient(135deg, #e3f2fd 0%, #fff 100%)' }}>
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5" sx={{ fontWeight: 700, color: '#1976d2' }}>
          <LocalShippingIcon sx={{ mr: 1, verticalAlign: 'middle' }} /> Deliveries
        </Typography>
        <Button variant="contained" size="medium" onClick={fetchDeliveries} disabled={loading} sx={{ boxShadow: 2 }}>
          Refresh
        </Button>
      </Box>
      <Box sx={{ maxHeight: 'calc(100vh - 140px)', overflowY: 'auto', pr: 1 }}>
        {(() => {
          // Group deliveries by ETA date
          const grouped = {};
          deliveries.forEach(row => {
            const etaDate = dayjs(row.eta).format('YYYY-MM-DD');
            if (!grouped[etaDate]) grouped[etaDate] = [];
            grouped[etaDate].push(row);
          });
          const sortedDates = Object.keys(grouped).sort((a, b) => dayjs(a).diff(dayjs(b)));
          const today = dayjs().format('YYYY-MM-DD');
          const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
          return sortedDates.map(date => {
            let label = date;
            if (date === today) label = 'Today';
            else if (date === tomorrow) label = 'Tomorrow';
            return (
              <Box key={date} sx={{ mb: 5 }}>
                <Typography variant="h6" sx={{ mb: 2, color: '#1976d2', fontWeight: 600 }}>{label}</Typography>
                {grouped[date].length === 0 ? (
                  <Typography sx={{ color: '#bbb', mb: 2 }}>No deliveries scheduled.</Typography>
                ) : (
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 3 }}>
                    {grouped[date].map(row => (
                      <Box key={row.id} sx={{ boxShadow: 3, borderRadius: 3, background: '#fff', p: 3, display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Box sx={{ width: 48, height: 48, bgcolor: '#e3f2fd', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <LocalShippingIcon sx={{ color: '#1976d2', fontSize: 32 }} />
                          </Box>
                          <Box>
                            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{row.supplier_name}</Typography>
                            <Typography variant="body2" sx={{ color: '#1976d2', fontWeight: 500 }}>ETA: {row.formattedEta}</Typography>
                          </Box>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                          <TextField
                            label="Pallets"
                            type="number"
                            size="small"
                            value={row.pallet_amount}
                            onChange={e => handleEditCellChange({ id: row.id, field: 'pallet_amount', value: e.target.value })}
                            sx={{ width: 100 }}
                            inputProps={{ min: 0 }}
                          />
                          <TextField
                            label="Boxes"
                            type="number"
                            size="small"
                            value={row.box_amount}
                            onChange={e => handleEditCellChange({ id: row.id, field: 'box_amount', value: e.target.value })}
                            sx={{ width: 100 }}
                            inputProps={{ min: 0 }}
                          />
                          <IconButton
                            sx={{ ml: 1 }}
                            onClick={e => {
                              setPopoverAnchor(e.currentTarget);
                              setPopoverPOs(row.po_numbers || []);
                            }}
                            color="primary"
                          >
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>POs</Typography>
                          </IconButton>
                          <Button
                            variant="outlined"
                            size="small"
                            color="success"
                            onClick={() => {
                              setSelectedDelivery(row);
                              setCompleteDialogOpen(true);
                            }}
                          >
                            Complete
                          </Button>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            );
          });
        })()}
      </Box>
      <Popover
        open={Boolean(popoverAnchor)}
        anchorEl={popoverAnchor}
        onClose={() => setPopoverAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, minWidth: 220 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>POs arriving this day:</Typography>
          <List dense>
            {popoverPOs.length === 0 ? (
              <ListItem><ListItemText primary="No POs" /></ListItem>
            ) : (
              popoverPOs.map(po => (
                <ListItem key={po}><ListItemText primary={po} /></ListItem>
              ))
            )}
          </List>
          <Box sx={{ mt: 2, textAlign: 'right' }}>
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                const row = deliveries.find(d => d.po_numbers && d.po_numbers.length && d.po_numbers.every(po => popoverPOs.includes(po)) && popoverPOs.every(po => d.po_numbers.includes(po)));
                if (row) {
                  const printWindow = window.open('', '', 'width=600,height=600');
                  printWindow.document.write('<html><head><title>Delivery Sheet</title>');
                  printWindow.document.write('<style>body{font-family:sans-serif;padding:24px;} h6{margin-bottom:16px;} .subtitle{font-weight:bold;margin-top:8px;} ul{margin:0;padding:0;} li{margin-bottom:4px;}</style>');
                  printWindow.document.write('</head><body>');
                  printWindow.document.write(`<h6>Delivery Sheet</h6>`);
                  printWindow.document.write(`<div class="subtitle">Vendor:</div> ${row.supplier_name}<br/>`);
                  printWindow.document.write(`<div class="subtitle">ETA:</div> ${row.formattedEta}<br/>`);
                  printWindow.document.write(`<div class="subtitle">Pallets:</div> ${row.pallet_amount}<br/>`);
                  printWindow.document.write(`<div class="subtitle">Boxes:</div> ${row.box_amount}<br/>`);
                  printWindow.document.write(`<div class="subtitle">POs:</div><ul>`);
                  if (row.po_numbers && row.po_numbers.length > 0) {
                    row.po_numbers.forEach(po => {
                      printWindow.document.write(`<li>${po}</li>`);
                    });
                  } else {
                    printWindow.document.write('<li>No POs</li>');
                  }
                  printWindow.document.write('</ul>');
                  printWindow.document.write('</body></html>');
                  printWindow.document.close();
                  printWindow.focus();
                  printWindow.print();
                  printWindow.close();
                  setPopoverAnchor(null);
                }
              }}
            >Print</Button>
          </Box>
        </Box>
      </Popover>

      <Dialog open={completeDialogOpen} onClose={() => setCompleteDialogOpen(false)} maxWidth="xs">
        <DialogTitle>Complete Delivery</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to mark all POs in this delivery as complete?
          </Typography>
          {selectedDelivery && (
            <Typography sx={{ mt: 1, color: '#666' }}>
              {selectedDelivery.supplier_name} • ETA {dayjs(selectedDelivery.eta).format('YYYY-MM-DD')} • {selectedDelivery.po_numbers?.length || 0} POs
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompleteDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="success" onClick={handleCompleteDelivery}>Yes, Complete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
