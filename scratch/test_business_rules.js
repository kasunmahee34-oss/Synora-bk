const http = require('http');
const querystring = require('querystring');

//const HOST = 'localhost';
//const PORT = process.env.PORT || 5000;
////////////////////////////////////////
const HOST = 'mysql-2b05b86f-kasunmahee34-2ead.e.aivencloud.com';
const PORT = process.env.PORT || 5000;
//////////////////////////////////////
function request(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST,
      port: PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting Test Scenarios ---');
  // Get an available room for reservations
  const roomsRes = await request('GET', '/api/rooms');
  if (roomsRes.status !== 200 || !Array.isArray(roomsRes.data) || roomsRes.data.length === 0) {
    console.error('No rooms available for tests');
    return;
  }
  const room = roomsRes.data[0];

  // Create a test guest
  const guestRes = await request('POST', '/api/guests', { fullName: 'Test Guest', phone: '123456', email: 'test@example.com' });
  if (guestRes.status !== 201) {
    console.error('Failed to create guest');
    return;
  }
  const guestId = guestRes.data.id;
  console.log('Created guest', guestId);

  // Helper to create a reservation with a given initial status
  async function createReservation(initialStatus) {
    const today = new Date();
    const checkIn = new Date(today.getTime() + 24 * 60 * 60 * 1000); // tomorrow
    const checkOut = new Date(checkIn.getTime() + 2 * 24 * 60 * 60 * 1000); // +2 days
    const payload = {
      guestId,
      roomId: room.id,
      checkIn: checkIn.toISOString().split('T')[0],
      checkOut: checkOut.toISOString().split('T')[0],
      rate: 100,
      status: initialStatus,
    };
    const res = await request('POST', '/api/reservations', payload);
    if (res.status !== 201) {
      console.error('Failed to create reservation', res);
      return null;
    }
    return res.data;
  }

  // Scenario 1: Tentative reservation without payment
  const res1 = await createReservation('tentative');
  if (!res1) return;
  const scenario1Pass = res1.status === 'tentative';
  console.log('Scenario 1', scenario1Pass ? 'PASS' : 'FAIL', 'Reservation status:', res1.status);
  console.log('Detailed check for Scenario 1 complete.');

  // Scenario 2: Advance payment before check-in
  const res2 = await createReservation('tentative');
  if (!res2) return;
  const payment2 = await request('POST', '/api/payments', {
    reservationId: res2.id,
    amount: 100,
    paymentMethod: 'cash',
    paymentCategory: 'advance',
    userId: 1,
  });
  const updatedRes2 = await request('GET', `/api/reservations/${res2.id}`);
  const scenario2Pass =
    payment2.status === 201 &&
    payment2.data.paymentCategory === 'advance' &&
    updatedRes2.data.status === 'guaranteed';
  console.log('Scenario 2', scenario2Pass ? 'PASS' : 'FAIL', {
    paymentCategory: payment2.data.paymentCategory,
    reservationStatus: updatedRes2.data.status,
  });

  // Scenario 3: Multiple advance payments
  const res3 = await createReservation('tentative');
  if (!res3) return;
  const payA = await request('POST', '/api/payments', {
    reservationId: res3.id,
    amount: 60,
    paymentMethod: 'cash',
    paymentCategory: 'advance',
    userId: 1,
  });
  const payB = await request('POST', '/api/payments', {
    reservationId: res3.id,
    amount: 40,
    paymentMethod: 'cash',
    paymentCategory: 'advance',
    userId: 1,
  });
  const paymentsList = await request('GET', `/api/payments/reservation/${res3.id}`);
  const totalPaid = paymentsList.data.reduce((sum, p) => sum + p.amount, 0);
  const updatedRes3 = await request('GET', `/api/reservations/${res3.id}`);
  const scenario3Pass =
    payA.status === 201 &&
    payB.status === 201 &&
    paymentsList.data.every((p) => p.paymentCategory === 'advance') &&
    totalPaid === 100 &&
    updatedRes3.data.status === 'guaranteed';
  console.log('Scenario 3', scenario3Pass ? 'PASS' : 'FAIL', {
    paymentsCount: paymentsList.data.length,
    totalPaid,
    reservationStatus: updatedRes3.data.status,
  });

  // Scenario 4: Payment after check-in (should not be advance payment)
  const res4 = await createReservation('tentative');
  if (!res4) return;
  // Simulate check‑in by setting status to in_house
  await request('PUT', `/api/reservations/${res4.id}/status`, { status: 'in_house' });
  const payment4 = await request('POST', '/api/payments', {
    reservationId: res4.id,
    amount: 40,
    paymentMethod: 'cash',
    paymentCategory: 'balance',
    userId: 1,
  });
  const scenario4Pass = payment4.status === 201 && payment4.data.paymentCategory === 'balance';
  console.log('Scenario 4', scenario4Pass ? 'PASS' : 'FAIL', { paymentCategory: payment4.data.paymentCategory });

  // Scenario 5: Early checkout
  const res5 = await createReservation('tentative');
  if (!res5) return;
  // Check‑in first
  await request('PUT', `/api/reservations/${res5.id}/status`, { status: 'in_house' });
  // Early checkout (status to checked_out)
  await request('PUT', `/api/reservations/${res5.id}/status`, { status: 'checked_out' });
  const finalRes5 = await request('GET', `/api/reservations/${res5.id}`);
  const scenario5Pass = finalRes5.data.status === 'checked_out';
  console.log('Scenario 5', scenario5Pass ? 'PASS' : 'FAIL', { finalStatus: finalRes5.data.status });

  console.log('--- Test Completed ---');
}

runTests().catch((e) => console.error('Test runner error', e));
