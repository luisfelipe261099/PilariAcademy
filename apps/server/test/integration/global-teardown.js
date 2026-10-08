module.exports = async () => {
  if (globalThis.__MYSQL_TEST__) await globalThis.__MYSQL_TEST__.stop()
}
