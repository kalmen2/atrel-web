import React, { useEffect, useState } from 'react';
import { Box, Typography, CircularProgress, Paper, List, ListItem, ListItemText } from '@mui/material';
import { API_BASE } from './apiConfig.js';

export default function LogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchLogs() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/logs`);
        if (!res.ok) throw new Error('Failed to fetch logs');
        const data = await res.json();
        setLogs(data.logs || []);
      } catch (err) {
        setError(err.message);
      }
      setLoading(false);
    }
    fetchLogs();
  }, []);

  return (
    <Box p={2}>
      <Typography variant="h5" gutterBottom>Function Logs</Typography>
      {loading && <CircularProgress />}
      {error && <Typography color="error">{error}</Typography>}
      {!loading && !error && (
        <Paper elevation={2}>
          <List>
            {logs.length === 0 && <ListItem><ListItemText primary="No logs found." /></ListItem>}
            {logs.map((log, idx) => (
              <ListItem key={idx} divider>
                <ListItemText
                  primary={log.message}
                  secondary={log.timestamp ? new Date(log.timestamp).toLocaleString() : ''}
                  style={{ color: log.level === 'error' ? 'red' : undefined }}
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      )}
    </Box>
  );
}
