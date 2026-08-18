// In-memory registry for invoices and settled transactions.
// Swap this for a database / real x402 relay when going to production.

const invoices = new Map();
const transactions = new Map();

function registerInvoice(invoice) {
  invoices.set(invoice.invoiceId, invoice);
  return invoice;
}

function getInvoice(invoiceId) {
  return invoices.get(invoiceId) || null;
}

function registerTransaction(tx) {
  transactions.set(tx.txId, tx);
  return tx;
}

function getTransaction(txId) {
  return transactions.get(txId) || null;
}

export { registerInvoice, getInvoice, registerTransaction, getTransaction };