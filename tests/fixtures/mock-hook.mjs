const input = [];
process.stdin.on('data', c => input.push(c));
process.stdin.on('end', () => {
  const data = JSON.parse(Buffer.concat(input).toString());
  if (data.metadata?.freeze) {
    process.stdout.write(JSON.stringify({ decision: "deny", reason: "code freeze active" }));
    process.exit(2);
  }
  process.stdout.write(JSON.stringify({
    decision: "allow",
    additional_context: `audit at ${data.metadata?.provider || "unknown"}`
  }));
});
