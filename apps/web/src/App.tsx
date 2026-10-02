import { Route, Routes } from 'react-router-dom';
import Header from './components/Header';
import CategoryPage from './pages/Category';
import Checkout from './pages/Checkout';
import CheckoutComplete from './pages/CheckoutComplete';
import Home from './pages/Home';
import NotFound from './pages/NotFound';
import OrderStatus from './pages/OrderStatus';
import ProductPage from './pages/Product';
import SearchPage from './pages/Search';
import RiderHome from './rider/RiderHome';

export default function App() {
  return (
    <Routes>
      {/* Riders get a bare, phone-first layout without the shop header. */}
      <Route path="/rider/*" element={<RiderHome />} />
      <Route
        path="*"
        element={
          <>
            <Header />
            <main className="container">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/c/:slug" element={<CategoryPage />} />
                <Route path="/p/:slug" element={<ProductPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/checkout" element={<Checkout />} />
                <Route path="/checkout/complete" element={<CheckoutComplete />} />
                <Route path="/order/:number" element={<OrderStatus />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </main>
          </>
        }
      />
    </Routes>
  );
}
