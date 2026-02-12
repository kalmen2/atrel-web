import React from 'react';
import { DataGrid } from '@mui/x-data-grid';

export default function CompactDataGrid({
  rows,
  columns,
  loading = false,
  getRowClassName,
  pageSizeOptions = [20, 50, 100],
  initialPageSize = 20,
  checkboxSelection = false,
  rowSelectionModel = [],
  onRowSelectionModelChange,
  sx = {},
  ...props
}) {
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      loading={loading}
      pageSizeOptions={pageSizeOptions}
      initialState={{ pagination: { paginationModel: { page: 0, pageSize: initialPageSize } } }}
      checkboxSelection={checkboxSelection}
      rowSelectionModel={rowSelectionModel}
      onRowSelectionModelChange={onRowSelectionModelChange}
      disableRowSelectionOnClick
      getRowClassName={getRowClassName}
      sx={{
        background: '#fff',
        fontSize: '13px',
        '& .MuiDataGrid-row': {
          minHeight: 32,
          maxHeight: 32,
          height: 32,
          fontSize: '13px',
        },
        '& .MuiDataGrid-cell': {
          padding: '4px 8px',
          fontSize: '13px',
        },
        '& .MuiDataGrid-columnHeaders': {
          minHeight: 52,
          maxHeight: 52,
          height: 32,
          fontSize: '13px',
        },
        '& .MuiDataGrid-columnHeader': {
          padding: '4px 8px',
          fontSize: '13px',
        },
        ...sx,
      }}
      {...props}
    />
  );
}
