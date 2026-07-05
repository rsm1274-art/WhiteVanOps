# White Van Ops — Golden State Demo Manual

**Objective**: Ensure your sales demos always start from a perfectly clean, pre-populated state. Avoid having to manually enter demo data for every client, and prevent Client B from seeing the test data you created during a demo for Client A.

Because White Van Ops runs entirely locally, you can physically copy the database folder to save a "Golden State" snapshot, and then paste it back to instantly reset the system.

---

## 1. Creating the Golden State (Do this once)

### Step 1: Build the Perfect Demo Environment
1. Launch White Van Ops on your dedicated demo laptop.
2. Manually enter your ideal demo dataset. This should include:
   - **Clients**: 2-3 realistic businesses (e.g., "Lakeside Mall", "Reyes Dental").
   - **Vehicles**: 3 vans (e.g., Van 01, Van 02, Van 03).
   - **Inventory**: Core items (e.g., Refrigerant, Capacitors) with stock assigned to the warehouse and the vans.
   - **Personnel**: 2 technicians and 1 dispatcher.
   - **Jobs**: 4-5 jobs (some Scheduled, some In Progress, some Completed).
3. Verify the dashboard looks populated and impressive.

### Step 2: Stop the Application
1. Close the White Van Ops application completely.
2. Check your Windows System Tray (bottom right corner) to ensure the app isn't running in the background. If it is, right-click and exit.

### Step 3: Copy the Database Folder
1. Open the Windows File Explorer.
2. In the address bar at the top, type `%APPDATA%\whitevanops` and press Enter. *(Note: If you are running the development build, this will be in your project folder under `pg_data`).*
3. You will see a folder named `pgdata`. This folder contains your entire PostgreSQL database and the perfect demo data you just created.
4. **Copy** the `pgdata` folder.
5. Go to your Desktop (or a dedicated folder), **Paste** it, and rename it to `pgdata_GOLDEN_DEMO`.

You now have an untainted snapshot of your perfect demo instance.

---

## 2. Resetting Before a New Demo (Takes 10 seconds)

Follow this procedure immediately before walking into a new client's office or hopping on a Zoom demo. 

1. **Close White Van Ops**: Ensure the application is completely shut down.
2. **Delete the Current Data**:
   - Open File Explorer and go to `%APPDATA%\whitevanops`.
   - **Delete** the existing `pgdata` folder. *(This wipes out all the messy test data you generated during your last demo).*
3. **Restore the Golden State**:
   - Copy your `pgdata_GOLDEN_DEMO` folder from your Desktop.
   - Paste it into `%APPDATA%\whitevanops`.
   - Rename it to `pgdata`.
4. **Launch White Van Ops**. You are now back at the exact starting line.

---

## 3. Advanced: The 1-Click Reset Script

If you want to look like a wizard and reset your demo environment with a single double-click, you can create a simple Windows Batch script on your desktop.

1. Right-click on your Desktop -> New -> Text Document.
2. Name it `Reset_WVO_Demo.bat` (make sure you delete the `.txt` extension).
3. Right-click the file and select **Edit**.
4. Paste the following code into the file:

```bat
@echo off
echo ==========================================
echo   White Van Ops - Golden State Reset
echo ==========================================
echo.
echo Make sure White Van Ops is completely closed!
pause

echo.
echo Wiping old demo data...
rmdir /S /Q "%APPDATA%\whitevanops\pgdata"

echo Restoring Golden State...
xcopy /E /I /H /Y "%USERPROFILE%\Desktop\pgdata_GOLDEN_DEMO" "%APPDATA%\whitevanops\pgdata"

echo.
echo Reset Complete! You can now launch White Van Ops.
pause
```

5. Save and close the file.
6. Now, before any demo, just double-click `Reset_WVO_Demo.bat`. It will instantly delete the dirty database and copy your pristine golden database back into place.
