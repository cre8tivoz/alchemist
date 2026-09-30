sed -i 's/<<<<<<< HEAD//g' src-tauri/src/db.rs
sed -i '/=======/,/>>>>>>> origin\/main/d' src-tauri/src/db.rs
