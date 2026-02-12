import React, { useState } from 'react';
import { Box, Drawer, IconButton, List, ListItemIcon, ListItemText, Divider, Toolbar, CssBaseline, ListItemButton, Collapse } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import InboxIcon from '@mui/icons-material/Inbox';
import GroupIcon from '@mui/icons-material/Group';
import AssignmentIcon from '@mui/icons-material/Assignment';
import ScheduleIcon from '@mui/icons-material/Schedule';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
// import WorkersProgressPage from './WorkersProgressPage.jsx';
import DeliveriesPage from './DeliveriesPage.jsx';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import OrdersPage from './OrdersPage.jsx';
import PurchaseOrdersPage from './PurchaseOrdersPage.jsx';
import LateOrdersPage from './LateOrdersPage.jsx';

const theme = createTheme({
  palette: {
    primary: { main: '#1976d2' },
    secondary: { main: '#e53935' },
  },
});

const drawerWidthExpanded = 220;
const drawerWidthCollapsed = 60;

export default function SidebarLayout() {
  const [expanded, setExpanded] = useState(true);
  const [page, setPage] = useState('orders');
  const [goflowOpen, setGoflowOpen] = useState(true);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <Drawer
          variant="permanent"
          open={expanded}
          sx={{
            width: expanded ? drawerWidthExpanded : drawerWidthCollapsed,
            flexShrink: 0,
            whiteSpace: 'nowrap',
            boxSizing: 'border-box',
            transition: (theme) => theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
            '& .MuiDrawer-paper': {
              width: expanded ? drawerWidthExpanded : drawerWidthCollapsed,
              transition: (theme) => theme.transitions.create('width', {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.enteringScreen,
              }),
              overflowX: 'hidden',
            },
          }}
        >
          <Toolbar sx={{ justifyContent: 'center', px: 1 }}>
            <IconButton onClick={() => setExpanded((e) => !e)}>
              {expanded ? <ChevronLeftIcon /> : <MenuIcon />}
            </IconButton>
          </Toolbar>
          <Divider />
          <List>
            <ListItemButton onClick={() => setGoflowOpen((open) => !open)}>
              <ListItemIcon>
                <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y+mAAAAaVBMVEX////Hzv52if5GZP5BYP5edv6ksP78/P+yvP5nff5DYv5rgP64wf54i/47W/6Ck/5Sbf7h5f/y8/9Xcf5LZ/58jv73+P+NnP7Cyv49Xf7P1f84Wf6ImP6dqv6ptP5Oaf7q7P+Tov7s7v+cC22mAAAAt0lEQVR4AeXOxQHEMAwEwA2zwox2/z0G5GALd/MxCPFXNN0wLdvBwfVMPwhxi8jU44TMFMhyKsrSIKuCUlJ9FDUlgKR1sbPJAuv6AZeRQrCJXD4HqnCq2gCnWZUmfNT6zpu941AlDud42AVGUSRJMRc7TlbB0uSDB3W45AkfDdlgC3l8fj49tVmaUAqEXKyZhQNW5WSNU0m9BmQ9BbYdkJHiYhd935YLdllt9r0vKrxki4PLIvFzNq+CCd8ZjE52AAAAAElFTkSuQmCC" alt="GoFlow" style={{ height: 28, width: 28, objectFit: 'contain' }} />
              </ListItemIcon>
              {expanded && <ListItemText primary="GoFlow" />}
              {expanded && (goflowOpen ? <ExpandLess /> : <ExpandMore />)}
            </ListItemButton>
            <Collapse in={goflowOpen} timeout="auto" unmountOnExit>
              <List component="div" disablePadding>
                <ListItemButton sx={{ pl: expanded ? 4 : 2 }} selected={page === 'orders'} onClick={() => setPage('orders')}>
                  <ListItemIcon>
                    {/* Cart Empty SVG icon for Orders, matching LateOrdersPage heading */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61l1.38-7.39H6"/></svg>
                  </ListItemIcon>
                  {expanded && <ListItemText primary="Orders" />}
                </ListItemButton>
                <ListItemButton sx={{ pl: expanded ? 4 : 2 }} selected={page === 'lateOrders'} onClick={() => setPage('lateOrders')}>
                  <ListItemIcon><ScheduleIcon /></ListItemIcon>
                  {expanded && <ListItemText primary="Late Orders" />}
                </ListItemButton>
              </List>
            </Collapse>
            {/* <ListItemButton selected={page === 'workers'} onClick={() => setPage('workers')}>
              <ListItemIcon><GroupIcon /></ListItemIcon>
              {expanded && <ListItemText primary="Workers Progress" />}
            </ListItemButton> */}
            <ListItemButton selected={page === 'purchaseOrders'} onClick={() => setPage('purchaseOrders')}>
              <ListItemIcon><AssignmentIcon /></ListItemIcon>
              {expanded && <ListItemText primary="Purchase Orders" />}
            </ListItemButton>
            <ListItemButton selected={page === 'deliveries'} onClick={() => setPage('deliveries')}>
              <ListItemIcon><InboxIcon /></ListItemIcon>
              {expanded && <ListItemText primary="Deliveries" />}
            </ListItemButton>
          </List>
        </Drawer>
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            transition: 'margin 0.3s',
            minWidth: 0,
            height: '100vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            p: 0,
          }}
        >
          {page === 'orders' && <OrdersPage />}
          {/* {page === 'workers' && <WorkersProgressPage />} */}
          {page === 'purchaseOrders' && <PurchaseOrdersPage />}
          {page === 'deliveries' && <DeliveriesPage key={page} />}
          {page === 'lateOrders' && <LateOrdersPage />}
        </Box>
      </Box>
    </ThemeProvider>
  );
}
