@echo off
cd /d C:\Users\wwwmo\Development\Major-Projects\spectra
set PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1
cargo check --package spectra-pyo3 2>&1
