const reportsService = require('../src/services/reportsService');

(async () => {
  try {
    console.log('Running Meal Plan Distribution validation...');
    const params = {
      dateFrom: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString().slice(0,10),
      dateTo: new Date().toISOString().slice(0,10)
    };
    const res = await reportsService.getMealPlanDistribution(params);
    if (res && Array.isArray(res.data)) {
      console.log('Distribution results count:', res.data.length);
      res.data.forEach(d => console.log(`${d.code} (${d.name}): reservations=${d.reservations}, roomNights=${d.roomNights}`));
      process.exit(0);
    } else {
      console.error('Unexpected response shape', res);
      process.exit(2);
    }
  } catch (err) {
    console.error('Validation failed:', err.message || err);
    process.exit(3);
  }
})();
