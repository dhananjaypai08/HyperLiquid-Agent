import { useEffect, useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import * as hl from "@nktkas/hyperliquid";
const transport = new hl.HttpTransport();
const client = new hl.PublicClient({ transport });

function App() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const fetchData = async () => {
      try {
        const openOrders = await client.openOrders({ user: "0x59e2d29935c7b475edfe0262b97b3c77f52a3967" });
        console.log(openOrders);

        // Fetching market details for a specific market
        // const marketDetails = await client.market({ market: "0x1" });
        // console.log("Market Details:", marketDetails);
        const data = await client.userVaultEquities({
          user: "0x59e2d29935c7b475edfe0262b97b3c77f52a3967",
          markets: ["0x1", "0x2", "0x3"] // Example market IDs
        });
        console.log("Details:", data);

        // Fetching user positions
        // const userPositions = await client.positions({ user: "0x59e2d29935c7b475edfe0262b97b3c77f52a3967" });
        // console.log("User Positions:", userPositions);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    fetchData();
  }
  , []);

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.jsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
