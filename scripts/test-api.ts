async function run() {
  console.log('Fetching Cine Colombia Config...');
  const res = await fetch('https://cms-api-multiplex.cinecolombia.com/api/v1/sales-channels/web/configuration', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  if (!res.ok) {
    console.error('Failed Config', res.status);
  } else {
    const data = await res.json();
    console.log('Config Keys:', Object.keys(data));
  }

  console.log('Fetching Movies...');
  const res2 = await fetch('https://cms-api-multiplex.cinecolombia.com/api/v1/movies', {
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });
  if (!res2.ok) {
    console.error('Failed Movies', res2.status);
  } else {
    const data2 = await res2.json();
    console.log(JSON.stringify(data2).substring(0, 500));
  }
}
run();
