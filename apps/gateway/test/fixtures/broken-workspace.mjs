// A workspace entry that fails before listening (the gateway must answer 502 and leave the link pending).
console.error("broken workspace: refusing to start");
process.exit(1);
