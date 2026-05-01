const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
require("dotenv").config();

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'super-refresh-secret-key';

app.use(cors());
app.use(express.json());


mongoose
  .connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/clinical_system')
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection failed:', err.message));

  

const userSchema = new mongoose.Schema(
  {
    name: String,
    username: { type: String, unique: true },
    passwordHash: String,
    role: String,
    refreshTokenHash: String,
    specialization: String,
    consultFee: Number,
    availability: [{ day: String, from: String, to: String }],
  },
  { timestamps: true }
);

const doctorRequestSchema = new mongoose.Schema(
  {
    fullName: String,
    specialization: String,
    preferredUsername: String,
    passwordHash: String,
    consultFee: Number,
  },
  { timestamps: true }
);

const caseSchema = new mongoose.Schema(
  {
    patientName: String,
    age: String,
    phone: String,
    cnic: String,
    doctorId: String,
    doctorName: String,
    appointmentDate: String,
    appointmentTime: String,
    reason: String,
    status: { type: String, default: 'doctor' },
    labStatus: { type: String, default: 'not_required' },
    pharmacyStatus: { type: String, default: 'not_required' },
    billingPaid: { type: Boolean, default: false },
    invoiceAmount: String,
    token: String,
    diagnosis: String,
    prescriptions: [{ id: String, name: String, price: Number }],
    recommendedTests: [{ id: String, name: String, price: Number }],
    timeline: [{ at: String, by: String, actorRole: String, action: String, note: String }],
  },
  { timestamps: true }
);

const appointmentSchema = new mongoose.Schema(
  {
    caseId: String,
    doctorId: String,
    doctorName: String,
    patientName: String,
    date: String,
    time: String,
    reason: String,
    status: { type: String, default: 'booked' },
  },
  { timestamps: true }
);

const labTestSchema = new mongoose.Schema(
  {
    name: { type: String, unique: true },
    price: Number,
    active: { type: Boolean, default: true },
    addedBy: String,
  },
  { timestamps: true }
);

const medicineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    mg: { type: String, default: '' },
    formula: { type: String, default: '' },
    quantity: { type: Number, default: 0 },
    price: { type: Number, required: true },
    threshold: { type: Number, default: 10 },
    active: { type: Boolean, default: true },
    addedBy: String,
  },
  { timestamps: true }
);
medicineSchema.index({ name: 1 }, { unique: true });
// ----------------------------------------------------

const billSchema = new mongoose.Schema(
  {
    caseId: String,
    patientName: String,
    patientAge: String,
    patientPhone: String,
    patientCNIC: String,
    doctorName: String,
    doctorId: String,
    doctorFee: Number,
    medicines: [{ name: String, price: Number, quantity: { type: Number, default: 1 } }],
    labTests: [{ name: String, price: Number }],
    extraLabCharges: { type: Number, default: 0 },
    extraPharmacyCharges: { type: Number, default: 0 },
    subtotal: Number,
    total: Number,
    token: String,
    collectedBy: String,
    collectedAt: { type: Date, default: Date.now },
    billType: String,
    title: String,
    services: [{ name: String, amount: Number }],
    totalAmount: Number,
    appointmentDetails: { date: String, time: String, day: String },
    generatedBy: String,
    generatedAt: Date,
    serviceDetails: { date: String, time: String, day: String },
  },
  { timestamps: true }
);

const User = mongoose.model('User', userSchema);
const DoctorRequest = mongoose.model('DoctorRequest', doctorRequestSchema);
const Case = mongoose.model('Case', caseSchema);
const Appointment = mongoose.model('Appointment', appointmentSchema);
const LabTest = mongoose.model('LabTest', labTestSchema);
const Medicine = mongoose.model('Medicine', medicineSchema);
const Bill = mongoose.model('Bill', billSchema);

const baseUsers = [
  { name: 'System Admin', username: 'admin', password: 'admin123', role: 'admin' },
  { name: 'Receptionist', username: 'reception', password: 'reception123', role: 'receptionist' },
  { name: 'Counter Desk', username: 'counter', password: 'counter123', role: 'counter' },
  { name: 'Lab Desk', username: 'lab', password: 'lab123', role: 'lab' },
  { name: 'Pharmacy Desk', username: 'pharmacy', password: 'pharmacy123', role: 'pharmacy' },
];

async function ensureBaseUsers() {
  for (const user of baseUsers) {
    const existing = await User.findOne({ username: user.username });
    if (!existing) {
      const passwordHash = await bcrypt.hash(user.password, 10);
      await User.create({ ...user, passwordHash });
    }
  }
}
ensureBaseUsers();

function auth(requiredRoles = []) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (requiredRoles.length && !requiredRoles.includes(payload.role)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ message: 'Invalid token' });
    }
  };
}

function signTokens(user) {
  const payload = {
    id: user._id.toString(),
    name: user.name,
    role: user.role,
    username: user.username,
  };
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}

function addTimelineEntry(caseDoc, actor, action, note = '') {
  caseDoc.timeline.push({
    at: new Date().toISOString(),
    by: actor.name,
    actorRole: actor.role,
    action,
    note,
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Clinic Management API', timestamp: new Date().toISOString() });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ message: 'Invalid credentials' });
  const { accessToken, refreshToken } = signTokens(user);
  user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  await user.save();
  res.json({
    accessToken,
    refreshToken,
    expiresInSeconds: 900,
    user: { id: user._id.toString(), name: user.name, username: user.username, role: user.role, specialization: user.specialization },
  });
});

app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ message: 'Missing refresh token' });
  let payload;
  try {
    payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
  } catch {
    return res.status(401).json({ message: 'Invalid refresh token' });
  }
  const user = await User.findById(payload.id);
  if (!user || !user.refreshTokenHash) return res.status(401).json({ message: 'Unauthorized' });
  const valid = await bcrypt.compare(refreshToken, user.refreshTokenHash);
  if (!valid) return res.status(401).json({ message: 'Unauthorized' });
  const tokens = signTokens(user);
  user.refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 10);
  await user.save();
  res.json({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresInSeconds: 900 });
});

app.post('/api/auth/logout', auth(), async (req, res) => {
  await User.findByIdAndUpdate(req.user.id, { refreshTokenHash: '' });
  res.json({ ok: true });
});

app.post('/api/auth/doctor-request', async (req, res) => {
  const { fullName, specialization, preferredUsername, password, consultFee } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);
  const request = await DoctorRequest.create({
    fullName,
    specialization,
    preferredUsername,
    passwordHash,
    consultFee: Number(consultFee || 2000),
  });
  res.status(201).json(request);
});

app.get('/api/admin/doctor-requests', auth(['admin']), async (_req, res) => {
  const requests = await DoctorRequest.find().sort({ createdAt: -1 });
  res.json(requests);
});

app.post('/api/admin/doctor-requests/:id/approve', auth(['admin']), async (req, res) => {
  const request = await DoctorRequest.findById(req.params.id);
  if (!request) return res.status(404).json({ message: 'Request not found' });
  const user = await User.create({
    name: request.fullName,
    username: request.preferredUsername,
    passwordHash: request.passwordHash,
    role: 'doctor',
    specialization: request.specialization,
    consultFee: request.consultFee,
    availability: [],
  });
  await DoctorRequest.findByIdAndDelete(req.params.id);
  res.json({ id: user._id.toString(), name: user.name, specialization: user.specialization, username: user.username });
});

app.delete('/api/admin/doctor-requests/:id', auth(['admin']), async (req, res) => {
  await DoctorRequest.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

app.get('/api/doctors', auth(), async (_req, res) => {
  const doctors = await User.find({ role: 'doctor' }).select('_id name specialization consultFee availability username');
  res.json(doctors);
});

app.get('/api/catalog/lab-tests', auth(), async (_req, res) => {
  const tests = await LabTest.find({ active: true }).sort({ name: 1 });
  res.json(tests);
});

app.get('/api/catalog/medicines', auth(), async (_req, res) => {
  const medicines = await Medicine.find({ active: true }).sort({ name: 1 });
  res.json(medicines);
});

app.post('/api/catalog/lab-tests', auth(['lab']), async (req, res) => {
  const { name, price } = req.body;
  const created = await LabTest.create({ name, price: Number(price || 0), addedBy: req.user.name });
  res.status(201).json(created);
});

app.post('/api/catalog/medicines', auth(['pharmacy', 'admin']), async (req, res) => {
  const { name, mg, formula, quantity, price, threshold } = req.body;
  const created = await Medicine.create({
    name,
    mg: mg || '',
    formula: formula || '',
    quantity: Number(quantity || 0),
    price: Number(price || 0),
    threshold: Number(threshold || 10),
    addedBy: req.user.name,
  });
  res.status(201).json(created);
});

// NEW: Stock update endpoint
app.patch('/api/medicines/:id/stock', auth(['pharmacy', 'admin']), async (req, res) => {
  const { quantity } = req.body;
  if (quantity === undefined || typeof quantity !== 'number') {
    return res.status(400).json({ message: 'Quantity is required and must be a number' });
  }
  const medicine = await Medicine.findById(req.params.id);
  if (!medicine) return res.status(404).json({ message: 'Medicine not found' });
  medicine.quantity = quantity;
  await medicine.save();
  res.json(medicine);
});

// NEW: Bulk import medicines via CSV
const upload = multer({ storage: multer.memoryStorage() });
app.post('/api/medicines/bulk', auth(['pharmacy', 'admin']), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const results = [];
  const bufferString = req.file.buffer.toString();
  const stream = Readable.from(bufferString);
  stream
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      try {
        const created = [];
        for (const row of results) {
          const medicine = new Medicine({
            name: row.name,
            mg: row.mg || '',
            formula: row.formula || '',
            quantity: Number(row.quantity) || 0,
            price: Number(row.price),
            threshold: Number(row.threshold) || 10,
            addedBy: req.user.name,
          });
          await medicine.save();
          created.push(medicine);
        }
        res.json({ message: `Added ${created.length} medicines`, medicines: created });
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });
});

app.post('/api/doctors', auth(['admin']), async (req, res) => {
  const { name, specialization, username, password, consultFee } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);
  const doctor = await User.create({
    name,
    specialization,
    username,
    passwordHash,
    role: 'doctor',
    consultFee: Number(consultFee || 2000),
    availability: [],
  });
  res.status(201).json(doctor);
});

app.patch('/api/doctors/:id', auth(['admin']), async (req, res) => {
  const targetId = req.params.id;
  const { name, specialization, username, consultFee, password } = req.body;
  const updatePayload = {
    name,
    specialization,
    username,
    consultFee: Number(consultFee || 2000),
  };
  if (password) {
    updatePayload.passwordHash = await bcrypt.hash(password, 10);
  }
  const doctor = await User.findByIdAndUpdate(targetId, updatePayload, { new: true });
  if (!doctor) return res.status(404).json({ message: 'Doctor not found' });
  res.json(doctor);
});

app.delete('/api/doctors/:id', auth(['admin']), async (req, res) => {
  console.log('Decoded user:', payload);
  const targetId = req.params.id;
  await User.findByIdAndDelete(targetId);
  res.json({ ok: true });
});

app.put('/api/doctors/:id/availability', auth(['admin', 'doctor']), async (req, res) => {
  const targetId = req.params.id;
  if (req.user.role === 'doctor' && req.user.id !== targetId) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  const { availability } = req.body;
  const doctor = await User.findByIdAndUpdate(targetId, { availability }, { new: true });
  res.json(doctor);
});

app.get('/api/cases', auth(), async (req, res) => {
  const { doctorId, day, page = 1, limit = 20, search = '', sortBy = 'createdAt', order = 'desc' } = req.query;
  const query = {};
  if (req.user.role === 'doctor') query.doctorId = req.user.id;
  if (doctorId) query.doctorId = doctorId;
  if (day) query.appointmentDate = day;
  if (search) {
    query.$or = [
      { patientName: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { cnic: { $regex: search, $options: 'i' } },
      { doctorName: { $regex: search, $options: 'i' } },
    ];
  }
  const sortDirection = order === 'asc' ? 1 : -1;
  const skip = (Number(page) - 1) * Number(limit);
  const [data, total] = await Promise.all([
    Case.find(query).sort({ [sortBy]: sortDirection }).skip(skip).limit(Number(limit)),
    Case.countDocuments(query),
  ]);
  res.json({
    data,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  });
});

app.post('/api/cases', auth(['receptionist', 'counter']), async (req, res) => {
  const conflict = await Appointment.findOne({
    doctorId: req.body.doctorId,
    date: req.body.appointmentDate,
    time: req.body.appointmentTime,
    status: { $ne: 'cancelled' },
  });
  if (conflict) {
    return res.status(409).json({ message: 'Selected doctor slot is already booked' });
  }
  const caseData = await Case.create({
    ...req.body,
    status: 'doctor',
    timeline: [
      {
        at: new Date().toISOString(),
        by: req.user.name,
        actorRole: req.user.role,
        action: 'Case created at reception/counter',
        note: `Appointment booked with Dr. ${req.body.doctorName}`,
      },
    ],
  });
  const appointment = await Appointment.create({
    caseId: caseData._id.toString(),
    doctorId: req.body.doctorId,
    doctorName: req.body.doctorName,
    patientName: req.body.patientName,
    date: req.body.appointmentDate,
    time: req.body.appointmentTime,
    reason: req.body.reason,
    status: 'booked',
  });
  caseData.appointmentId = appointment._id.toString();
  await caseData.save();
  res.status(201).json(caseData);
});

app.get('/api/appointments', auth(), async (req, res) => {
  const { doctorId, day } = req.query;
  const query = {};
  if (req.user.role === 'doctor') query.doctorId = req.user.id;
  if (doctorId) query.doctorId = doctorId;
  if (day) query.date = day;
  const items = await Appointment.find(query).sort({ date: 1, time: 1 });
  res.json(items);
});

app.patch('/api/cases/:id', auth(), async (req, res) => {
  const caseDoc = await Case.findById(req.params.id);
  if (!caseDoc) return res.status(404).json({ message: 'Case not found' });
  if (req.user.role === 'doctor' && caseDoc.doctorId !== req.user.id) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  Object.assign(caseDoc, req.body);
  addTimelineEntry(caseDoc, req.user, req.body.timelineAction || 'Case updated', req.body.timelineNote || '');
  const labDone = caseDoc.labStatus === 'done' || caseDoc.labStatus === 'not_required';
  const pharmDone = caseDoc.pharmacyStatus === 'done' || caseDoc.pharmacyStatus === 'not_required';
  if (caseDoc.billingPaid && labDone && pharmDone) caseDoc.status = 'closed';
  await caseDoc.save();
  res.json(caseDoc);
});

app.get('/api/cases/:id/timeline', auth(), async (req, res) => {
  const caseDoc = await Case.findById(req.params.id).select('timeline');
  if (!caseDoc) return res.status(404).json({ message: 'Case not found' });
  res.json(caseDoc.timeline || []);
});

app.post('/api/bills', auth(['receptionist', 'counter', 'admin', 'doctor']), async (req, res) => {
  const billData = req.body;
  const caseDoc = await Case.findById(billData.caseId);
  if (!caseDoc) return res.status(404).json({ message: 'Case not found' });
  
  if (billData.services && billData.billType) {
    const bill = new Bill({
      caseId: billData.caseId,
      patientName: billData.patientName || caseDoc.patientName,
      patientAge: caseDoc.age,
      patientPhone: caseDoc.phone,
      patientCNIC: caseDoc.cnic,
      doctorName: billData.doctorName || caseDoc.doctorName,
      billType: billData.billType,
      title: billData.title,
      services: billData.services,
      totalAmount: billData.totalAmount,
      appointmentDetails: billData.appointmentDetails,
      serviceDetails: billData.serviceDetails,
      generatedBy: billData.generatedBy || req.user.name,
      generatedAt: billData.generatedAt || new Date(),
    });
    await bill.save();
    res.json(bill);
    return;
  }
  
  const { caseId, doctorFee = 0, medicines, labTests, extraLabCharges, extraPharmacyCharges, token } = req.body;
  const finalDoctorFee = Number(doctorFee) > 0 ? Number(doctorFee) : 0;
  const subtotal = finalDoctorFee + 
    (medicines?.reduce((sum, m) => sum + (m.price * (m.quantity || 1)), 0) || 0) + 
    (labTests?.reduce((sum, t) => sum + t.price, 0) || 0);
  const total = subtotal + (extraLabCharges || 0) + (extraPharmacyCharges || 0);
  const bill = new Bill({
    caseId,
    patientName: caseDoc.patientName,
    patientAge: caseDoc.age,
    patientPhone: caseDoc.phone,
    patientCNIC: caseDoc.cnic,
    doctorName: caseDoc.doctorName,
    doctorFee: finalDoctorFee,
    medicines: medicines || [],
    labTests: labTests || [],
    extraLabCharges: extraLabCharges || 0,
    extraPharmacyCharges: extraPharmacyCharges || 0,
    subtotal,
    total,
    token,
    collectedBy: req.user.name,
  });
  await bill.save();
  res.json(bill);
});

app.get('/api/bills/:id', auth(), async (req, res) => {
  const bill = await Bill.findById(req.params.id);
  if (!bill) return res.status(404).json({ message: 'Bill not found' });
  res.json(bill);
});

app.get('/api/bills', auth(), async (req, res) => {
  const { caseId } = req.query;
  if (caseId) {
    const bills = await Bill.find({ caseId }).sort({ createdAt: -1 });
    res.json(bills);
  } else {
    const bills = await Bill.find().sort({ createdAt: -1 }).limit(50);
    res.json(bills);
  }
});

// Update medicine (except quantity)
app.put('/api/medicines/:id', auth(['pharmacy', 'admin']), async (req, res) => {
  const { name, mg, formula, price, threshold } = req.body;
  const medicine = await Medicine.findById(req.params.id);
  if (!medicine) return res.status(404).json({ message: 'Medicine not found' });
  
  if (name) medicine.name = name;
  if (mg !== undefined) medicine.mg = mg;
  if (formula !== undefined) medicine.formula = formula;
  if (price !== undefined) medicine.price = Number(price);
  if (threshold !== undefined) medicine.threshold = Number(threshold);
  
  await medicine.save();
  res.json(medicine);
});

// Delete medicine (only if not used in any prescription)
app.delete('/api/medicines/:id', auth(['pharmacy', 'admin']), async (req, res) => {
  const medicineId = req.params.id;
  
  // Check if this medicine is used in any case's prescriptions
  const usedInCases = await Case.findOne({ 'prescriptions.id': medicineId });
  if (usedInCases) {
    return res.status(409).json({ 
      message: 'Cannot delete: this medicine is used in existing prescriptions. Remove it from all patient records first.' 
    });
  }
  
  const medicine = await Medicine.findByIdAndDelete(medicineId);
  if (!medicine) return res.status(404).json({ message: 'Medicine not found' });
  res.json({ message: 'Medicine deleted successfully' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});