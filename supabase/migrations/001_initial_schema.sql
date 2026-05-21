CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT,
  phone TEXT UNIQUE,
  email TEXT UNIQUE,
  role TEXT CHECK (role IN ('customer','provider','admin')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE providers (
  id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT CHECK (plan IN ('starter','pro','business','pay_per_job')),
  status TEXT CHECK (status IN ('pending','active','suspended')) DEFAULT 'pending',
  rating NUMERIC(3,2) DEFAULT 5.00,
  jobs_this_month INTEGER DEFAULT 0,
  verified_badge BOOLEAN DEFAULT false,
  documents JSONB,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE provider_locations (
  provider_id UUID PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  location GEOMETRY(Point,4326) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES users(id),
  location GEOMETRY(Point,4326) NOT NULL,
  location_address TEXT,
  problem_type TEXT CHECK (problem_type IN ('flat_tire','battery','tow','other')),
  note TEXT,
  status TEXT CHECK (status IN ('open','accepted','in_progress','completed','cancelled')) DEFAULT 'open',
  accepted_by UUID REFERENCES providers(id),
  price_estimate_min INTEGER,
  price_estimate_max INTEGER,
  final_price INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID UNIQUE REFERENCES requests(id),
  provider_id UUID REFERENCES providers(id),
  commission_rate NUMERIC(5,2),
  commission_amount INTEGER,
  stripe_payment_intent_id TEXT,
  completed_at TIMESTAMPTZ
);

CREATE TABLE ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID UNIQUE REFERENCES jobs(id),
  provider_id UUID REFERENCES providers(id),
  stars INTEGER CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE request_locks (
  request_id UUID PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES providers(id),
  locked_until TIMESTAMPTZ NOT NULL
);

CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now(),
  payload JSONB
);

CREATE TABLE payout_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stripe_payout_id TEXT,
  amount INTEGER,
  currency TEXT DEFAULT 'AED',
  arrival_date DATE,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE price_estimates (
  problem_type TEXT PRIMARY KEY,
  min_aed INTEGER NOT NULL,
  max_aed INTEGER NOT NULL
);

INSERT INTO price_estimates VALUES
  ('flat_tire', 80, 200),
  ('battery', 100, 250),
  ('tow', 200, 800),
  ('other', 150, 500);

CREATE INDEX idx_requests_location ON requests USING GIST(location);
CREATE INDEX idx_provider_locations ON provider_locations USING GIST(location);
CREATE INDEX idx_provider_locations_updated ON provider_locations(updated_at);
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_providers_status ON providers(status);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_estimates ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

CREATE POLICY "Users read own data" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own data" ON users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admin full access" ON users FOR ALL USING (is_admin());

CREATE POLICY "Providers read own data" ON providers FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Providers update own data" ON providers FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admin full access" ON providers FOR ALL USING (is_admin());
CREATE POLICY "Customers read active providers" ON providers FOR SELECT USING (status = 'active');

CREATE POLICY "Providers insert own location" ON provider_locations FOR INSERT WITH CHECK (auth.uid() = provider_id);
CREATE POLICY "Providers update own location" ON provider_locations FOR UPDATE USING (auth.uid() = provider_id) WITH CHECK (auth.uid() = provider_id);
CREATE POLICY "Active providers location visible" ON provider_locations FOR SELECT USING (EXISTS (SELECT 1 FROM providers WHERE id = provider_id AND status = 'active'));

CREATE POLICY "Customers read own requests" ON requests FOR SELECT USING (auth.uid() = customer_id);
CREATE POLICY "Customers create requests" ON requests FOR INSERT WITH CHECK (auth.uid() = customer_id);
CREATE POLICY "Customers cancel own open request" ON requests FOR UPDATE USING (auth.uid() = customer_id AND status = 'open');
CREATE POLICY "Active providers read open requests" ON requests FOR SELECT USING (status = 'open' AND EXISTS (SELECT 1 FROM providers WHERE id = auth.uid() AND status = 'active'));
CREATE POLICY "Provider reads accepted request" ON requests FOR SELECT USING (accepted_by = auth.uid());
CREATE POLICY "Admin full access" ON requests FOR ALL USING (is_admin());

CREATE POLICY "Provider reads own jobs" ON jobs FOR SELECT USING (provider_id = auth.uid());
CREATE POLICY "Admin full access" ON jobs FOR ALL USING (is_admin());

CREATE POLICY "Customer creates rating" ON ratings FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM jobs JOIN requests ON requests.id = jobs.request_id WHERE jobs.id = job_id AND requests.customer_id = auth.uid()));
CREATE POLICY "Public read ratings" ON ratings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin full access" ON ratings FOR ALL USING (is_admin());

CREATE POLICY "Providers read locks" ON request_locks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin full access" ON request_locks FOR ALL USING (is_admin());

CREATE POLICY "Admin full access only" ON stripe_events FOR ALL USING (is_admin());

CREATE POLICY "Admin full access only" ON payout_log FOR ALL USING (is_admin());

CREATE POLICY "Public read price estimates" ON price_estimates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin full access" ON price_estimates FOR ALL USING (is_admin());

CREATE OR REPLACE FUNCTION update_provider_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE providers
  SET rating = (
    SELECT ROUND(AVG(stars)::NUMERIC, 2)
    FROM (
      SELECT stars FROM ratings WHERE provider_id = NEW.provider_id ORDER BY created_at DESC LIMIT 50
    ) last50
  )
  WHERE id = NEW.provider_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_update_provider_rating
AFTER INSERT ON ratings
FOR EACH ROW EXECUTE FUNCTION update_provider_rating();

CREATE OR REPLACE FUNCTION check_provider_suspension()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.rating < 3.0 AND (SELECT COUNT(*) FROM ratings WHERE provider_id = NEW.id) >= 5 THEN
    UPDATE providers SET status = 'suspended' WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_check_suspension
AFTER UPDATE OF rating ON providers
FOR EACH ROW EXECUTE FUNCTION check_provider_suspension();
