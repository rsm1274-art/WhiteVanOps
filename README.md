# White Van Ops

White Van Ops is a consultancy-grade, minimalist field operations management platform designed for service businesses. It runs entirely on your own hardware, eliminating recurring cloud subscription costs and maximizing data privacy.

## Features

- **Self-Hosted Office Server**: Bundles Next.js, PM2, and PostgreSQL into a single Windows Electron executable. 
- **Direct Field Connectivity**: Utilizes Port Forwarding and Dynamic DNS to establish a direct connection between your field technicians' mobile devices and your office PC—no central cloud server routing required.
- **Offline-First PWA (Field Module)**: Technicians can access their jobs, log time, and update statuses even without an active internet connection. Changes are cached locally using IndexedDB and automatically sync in the background when connectivity is restored.
- **Ironclad Backup & Recovery**: Configure a "Target Directory Mirror" in the System Settings to automatically trigger a nightly `pg_dump` backup to a local USB drive, NAS, or synchronized drive folder at 2:00 AM.
- **No Monthly Fees**: No AWS/Azure overhead. Optional lifetime priority support is available for $250.

## Getting Started

Refer to the included manuals for comprehensive instructions:
- **[MANUAL_Setup_Installation.md](./MANUAL_Setup_Installation.md)**: Network setup, installation, and Port Forwarding configuration.
- **[MANUAL_Administrator.md](./MANUAL_Administrator.md)**: Office dashboard operation.
- **[MANUAL_Field_Tech.md](./MANUAL_Field_Tech.md)**: Technician field module guide.
