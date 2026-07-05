# White Van Field Operations Application - Architecture & Schema Plan

## 1. Core Objective & Architecture Acknowledgment
I have received and understood the parameters for the "White Van" application.
*   **Role:** Minimalist Field Operations management (no invoicing/payroll execution).
*   **Tech Stack:** Next.js (App Router) for full-stack React framework, Tailwind CSS, PostgreSQL via Prisma.
*   **Design:** Professional, high-contrast, minimalist (McKinsey/E&Y style) using the **Roboto** font.
*   **QuickBooks Export:** Strict CSV exports for Invoices (Line Items) and Time Tracking (Labor).
*   **Protocol:** "Explain Then Code" protocol will be strictly adhered to.

## 2. Entity-Relationship Diagram (ERD)

Below is the updated relational data architecture mapped out in Mermaid syntax. This schema supports multi-location inventory (warehouse vs. vans) and includes client-specific payment terms. I've also added QuickBooks sync status fields to prevent duplicate exports.

```mermaid
erDiagram
    CLIENT ||--o{ JOB : "has many"
    CLIENT {
        String id PK
        String name
        String contactName
        String locationAddress
        String paymentTerms
    }

    VEHICLE ||--o{ MAINTENANCE_LOG : "logs"
    VEHICLE ||--o{ JOB : "assigned to"
    VEHICLE ||--o| STOCK_LOCATION : "has inventory in"
    VEHICLE {
        String id PK
        String vin UK
        String make
        String model
        String status
    }

    MAINTENANCE_LOG {
        String id PK
        String vehicleId FK
        DateTime date
        Float cost
        String description
        Int odometer
    }

    PERSONNEL ||--o{ JOB_ASSIGNMENT : "assigned to"
    PERSONNEL ||--o{ TIME_ENTRY : "logs time"
    PERSONNEL {
        String id PK
        String firstName
        String lastName
        String role
        String certifications
    }

    INVENTORY_ITEM ||--o{ STOCK_LEVEL : "has levels in"
    INVENTORY_ITEM ||--o{ JOB_LINE_ITEM : "used in"
    INVENTORY_ITEM {
        String id PK
        String name
        String category
        String subCategory
        Float defaultRate
    }

    STOCK_LOCATION ||--o{ STOCK_LEVEL : "contains"
    STOCK_LOCATION {
        String id PK
        String name
        String type 
        String vehicleId FK
    }

    STOCK_LEVEL {
        String id PK
        String inventoryItemId FK
        String stockLocationId FK
        Int quantity
        Int minThreshold
    }

    JOB ||--o{ JOB_ASSIGNMENT : "has"
    JOB ||--o{ JOB_LINE_ITEM : "contains"
    JOB ||--o{ TIME_ENTRY : "tracks time for"
    JOB {
        String id PK
        String clientId FK
        String assignedVehicleId FK
        String status
        DateTime scheduledDate
        DateTime completionDate
        String qbInvoiceSyncStatus
    }

    JOB_ASSIGNMENT {
        String id PK
        String jobId FK
        String personnelId FK
    }

    JOB_LINE_ITEM {
        String id PK
        String jobId FK
        String inventoryItemId FK
        Int quantity
        Float rate
        String description
    }

    TIME_ENTRY {
        String id PK
        String jobId FK
        String personnelId FK
        DateTime date
        String duration
        String serviceItem
        String payrollItem
        String qbTimeSyncStatus
    }
```

## 3. Explanation of Database Schema

### Clients & Jobs
*   **Client** stores the core CRM data. Crucially, it now includes `paymentTerms` (e.g., Net 15, Net 30), which will be used to dynamically calculate the Invoice Due Date during QuickBooks export.
*   **Job** acts as the central hub of operations. It tracks the core schedule, links directly to `Client` and `Vehicle`. I've added a `qbInvoiceSyncStatus` (e.g., "Pending", "Exported") to prevent accidental duplicate billing of line items.

### Personnel & Scheduling Engine
*   **Personnel** stores employee records.
*   **JobAssignment** allows multiple Technicians to be assigned to a single Job while ensuring only a single Vehicle is dispatched.

### Fleet & Maintenance
*   **Vehicle** tracks the fleet.
*   **MaintenanceLog** records individual maintenance events linked to a Vehicle.

### Inventory Control (Warehouse & Van)
*   **InventoryItem** defines the global product catalog. It holds the QuickBooks required `category`, `subCategory`, and `name`.
*   **StockLocation** defines a physical place where inventory is held. It can be a "Warehouse" or linked directly to a "Vehicle" via the `vehicleId` foreign key.
*   **StockLevel** maps a specific `InventoryItem` to a `StockLocation`, tracking real-time `quantity` and `minThreshold` per van or warehouse.
*   **JobLineItem** links consumed items directly to the Job. When a Job is completed, the system will deduct the consumed quantity from the `StockLevel` associated with that Job's `assignedVehicleId`.

### QuickBooks Time Tracking
*   **TimeEntry** matches the Quickbooks Labor Export schema. It enforces the `duration` text format (HH:MM). Like Jobs, it includes `qbTimeSyncStatus` to prevent exporting duplicate timesheets.

## User Review Required

> [!IMPORTANT]
> **Feedback Needed Before Proceeding:**
> Please review this updated schema. If this aligns perfectly with your operations, I will move into execution and begin Phase 1 (Next.js initialization and Prisma model setup) using the strict "Explain Then Code" protocol.
