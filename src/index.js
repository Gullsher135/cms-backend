const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
const http = require('http');
const { Server } = require('socket.io');

require("dotenv").config();
dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'super-refresh-secret-key';

// Socket.io setup
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
app.set('io', io);

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

app.use(cors());
app.use(express.json());

mongoose
  .connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/clinical_system')
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection failed:', err.message));

// ======================= SCHEMAS =======================
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
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
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

// Enhanced Patient Schema with full EHR fields
const patientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    age: String,
    phone: { type: String, required: true, unique: true },
    cnic: String,
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    address: String,
    emergencyContact: String,
    // EHR fields
    allergies: [{ type: String }],
    problemList: [{
      problem: String,
      diagnosedDate: Date,
      status: { type: String, enum: ['active', 'resolved', 'inactive'], default: 'active' },
      notes: String
    }],
    immunizations: [{
      name: String,
      date: Date,
      provider: String,
      nextDue: Date,
      lotNumber: String
    }],
    vitals: [{
      date: { type: Date, default: Date.now },
      bpSystolic: Number,
      bpDiastolic: Number,
      pulse: Number,
      temperature: Number,
      weight: Number,
      height: Number,
      bmi: Number,
      notes: String
    }],
    clinicalNotes: [{
      date: { type: Date, default: Date.now },
      type: { type: String, enum: ['SOAP', 'Progress', 'Discharge', 'Referral'], default: 'SOAP' },
      subjective: String,
      objective: String,
      assessment: String,
      plan: String,
      doctorId: String,
      doctorName: String,
      signed: { type: Boolean, default: false }
    }]
  },
  { timestamps: true }
);
patientSchema.index({ phone: 1 });
patientSchema.index({ cnic: 1 });

const patientReportSchema = new mongoose.Schema(
  {
    patientName: { type: String, required: true },
    phone: { type: String, required: true },
    cnic: { type: String },
    age: String,
    gender: { type: String, enum: ['Male', 'Female', 'Other'], default: 'Male' },
    doctorId: { type: String, required: true },
    doctorName: { type: String, required: true },
    diagnosis: { type: String, required: true },
    prescriptions: [{ id: String, name: String, price: Number, quantity: Number }],
    recommendedTests: [{ id: String, name: String, price: Number }],
    reportDate: { type: Date, default: Date.now },
    notes: String,
  },
  { timestamps: true }
);
patientReportSchema.index({ phone: 1, reportDate: -1 });
patientReportSchema.index({ cnic: 1, reportDate: -1 });

// Models
const User = mongoose.model('User', userSchema);
const DoctorRequest = mongoose.model('DoctorRequest', doctorRequestSchema);
const Case = mongoose.model('Case', caseSchema);
const Appointment = mongoose.model('Appointment', appointmentSchema);
const LabTest = mongoose.model('LabTest', labTestSchema);
const Medicine = mongoose.model('Medicine', medicineSchema);
const Bill = mongoose.model('Bill', billSchema);
const Patient = mongoose.model('Patient', patientSchema);
const PatientReport = mongoose.model('PatientReport', patientReportSchema);

// ======================= INITIAL DATA =======================
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

// ======================= HELPERS =======================
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

// ======================= HEALTH =======================
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Clinic Management API', timestamp: new Date().toISOString() });
});

// ======================= AUTH =======================
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

// ======================= DOCTOR REQUESTS =======================
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
  const io = req.app.get('io');
  io.emit('doctor:created', { id: user._id.toString(), name: user.name, specialization: user.specialization, username: user.username });
  res.json({ id: user._id.toString(), name: user.name, specialization: user.specialization, username: user.username });
});

app.delete('/api/admin/doctor-requests/:id', auth(['admin']), async (req, res) => {
  await DoctorRequest.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ======================= DOCTORS =======================
app.get('/api/doctors', auth(), async (_req, res) => {
  const doctors = await User.find({ role: 'doctor' }).select('_id name specialization consultFee availability username');
  res.json(doctors);
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
  const io = req.app.get('io');
  io.emit('doctor:created', { id: doctor._id.toString(), name: doctor.name, specialization: doctor.specialization, username: doctor.username, consultFee: doctor.consultFee });
  res.status(201).json(doctor);
});

app.patch('/api/doctors/:id', auth(['admin']), async (req, res) => {
  const targetId = req.params.id;
  const { name, specialization, username, consultFee, password } = req.body;
  const updatePayload = { name, specialization, username, consultFee: Number(consultFee || 2000) };
  if (password) updatePayload.passwordHash = await bcrypt.hash(password, 10);
  const doctor = await User.findByIdAndUpdate(targetId, updatePayload, { new: true });
  if (!doctor) return res.status(404).json({ message: 'Doctor not found' });
  const io = req.app.get('io');
  io.emit('doctor:updated', { id: doctor._id.toString(), name: doctor.name, specialization: doctor.specialization, username: doctor.username, consultFee: doctor.consultFee });
  res.json(doctor);
});

app.delete('/api/doctors/:id', auth(['admin']), async (req, res) => {
  const doctorId = req.params.id;
  try {
    if (!mongoose.Types.ObjectId.isValid(doctorId)) return res.status(400).json({ message: 'Invalid doctor ID format' });
    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== 'doctor') return res.status(404).json({ message: 'Doctor not found' });
    const hasCases = await Case.exists({ doctorId });
    const hasAppointments = await Appointment.exists({ doctorId });
    const hasBills = await Bill.exists({ doctorId });
    if (hasCases || hasAppointments || hasBills) {
      return res.status(400).json({ message: 'Cannot delete doctor: they have existing cases, appointments, or bills. Reassign or archive them first.' });
    }
    await User.findByIdAndDelete(doctorId);
    const io = req.app.get('io');
    io.emit('doctor:deleted', { id: doctorId });
    res.status(200).json({ message: 'Doctor deleted successfully' });
  } catch (error) {
    console.error('Delete doctor error:', error);
    res.status(500).json({ message: 'Internal server error: ' + error.message });
  }
});

app.put('/api/doctors/:id/availability', auth(['admin', 'doctor']), async (req, res) => {
  const targetId = req.params.id;
  if (req.user.role === 'doctor' && req.user.id !== targetId) return res.status(403).json({ message: 'Forbidden' });
  const { availability } = req.body;
  const doctor = await User.findByIdAndUpdate(targetId, { availability }, { new: true });
  res.json(doctor);
});

// ======================= CATALOGS =======================
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
  const io = req.app.get('io');
  io.emit('labtest:created', created);
  res.status(201).json(created);
});

app.post('/api/catalog/medicines', auth(['pharmacy', 'admin']), async (req, res) => {
  const { name, mg, formula, quantity, price, threshold } = req.body;
  const created = await Medicine.create({
    name, mg: mg || '', formula: formula || '',
    quantity: Number(quantity || 0), price: Number(price || 0),
    threshold: Number(threshold || 10), addedBy: req.user.name,
  });
  const io = req.app.get('io');
  io.emit('medicine:created', created);
  res.status(201).json(created);
});

app.patch('/api/medicines/:id/stock', auth(['pharmacy', 'admin']), async (req, res) => {
  const { quantity } = req.body;
  if (quantity === undefined || typeof quantity !== 'number') return res.status(400).json({ message: 'Quantity is required and must be a number' });
  const medicine = await Medicine.findById(req.params.id);
  if (!medicine) return res.status(404).json({ message: 'Medicine not found' });
  medicine.quantity = quantity;
  await medicine.save();
  const io = req.app.get('io');
  io.emit('medicine:updated', medicine);
  res.json(medicine);
});

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
  const io = req.app.get('io');
  io.emit('medicine:updated', medicine);
  res.json(medicine);
});

app.delete('/api/medicines/:id', auth(['pharmacy', 'admin']), async (req, res) => {
  const medicineId = req.params.id;
  const usedInCases = await Case.findOne({ 'prescriptions.id': medicineId });
  if (usedInCases) return res.status(409).json({ message: 'Cannot delete: this medicine is used in existing prescriptions. Remove it from all patient records first.' });
  const medicine = await Medicine.findByIdAndDelete(medicineId);
  if (!medicine) return res.status(404).json({ message: 'Medicine not found' });
  const io = req.app.get('io');
  io.emit('medicine:deleted', { id: medicineId });
  res.json({ message: 'Medicine deleted successfully' });
});

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
            name: row.name, mg: row.mg || '', formula: row.formula || '',
            quantity: Number(row.quantity) || 0, price: Number(row.price),
            threshold: Number(row.threshold) || 10, addedBy: req.user.name,
          });
          await medicine.save();
          created.push(medicine);
        }
        const io = req.app.get('io');
        created.forEach(med => io.emit('medicine:created', med));
        res.json({ message: `Added ${created.length} medicines`, medicines: created });
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });
});

// ======================= CASES =======================
app.get('/api/cases', auth(), async (req, res) => {
  const { doctorId, day, page = 1, limit = 20, search = '', sortBy = 'createdAt', order = 'desc' } = req.query;
  const query = {};
  if (req.user.role === 'doctor') query.doctorId = req.user.id;
  if (doctorId) query.doctorId = doctorId;
  if (day) query.appointmentDate = day;
  if (search) query.$or = [
    { patientName: { $regex: search, $options: 'i' } },
    { phone: { $regex: search, $options: 'i' } },
    { cnic: { $regex: search, $options: 'i' } },
    { doctorName: { $regex: search, $options: 'i' } },
  ];
  const sortDirection = order === 'asc' ? 1 : -1;
  const skip = (Number(page) - 1) * Number(limit);
  const [data, total] = await Promise.all([
    Case.find(query).sort({ [sortBy]: sortDirection }).skip(skip).limit(Number(limit)),
    Case.countDocuments(query),
  ]);
  res.json({ data, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
});

app.post('/api/cases', auth(['receptionist', 'counter']), async (req, res) => {
  const conflict = await Appointment.findOne({
    doctorId: req.body.doctorId,
    date: req.body.appointmentDate,
    time: req.body.appointmentTime,
    status: { $ne: 'cancelled' },
  });
  if (conflict) return res.status(409).json({ message: 'Selected doctor slot is already booked' });

  // Find or create patient master record
  let patient = await Patient.findOne({ phone: req.body.phone });
  if (!patient) {
    patient = new Patient({
      name: req.body.patientName,
      age: req.body.age,
      phone: req.body.phone,
      cnic: req.body.cnic || '',
    });
    await patient.save();
  } else {
    patient.name = req.body.patientName;
    patient.age = req.body.age;
    if (req.body.cnic) patient.cnic = req.body.cnic;
    await patient.save();
  }

  const caseData = await Case.create({
    ...req.body,
    patientId: patient._id,
    status: 'doctor',
    timeline: [{
      at: new Date().toISOString(),
      by: req.user.name,
      actorRole: req.user.role,
      action: 'Case created at reception/counter',
      note: `Appointment booked with Dr. ${req.body.doctorName}`,
    }],
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
  const io = req.app.get('io');
  io.emit('case:created', caseData);
  res.status(201).json(caseData);
});

app.patch('/api/cases/:id', auth(), async (req, res) => {
  const caseDoc = await Case.findById(req.params.id);
  if (!caseDoc) return res.status(404).json({ message: 'Case not found' });
  if (req.user.role === 'doctor' && caseDoc.doctorId !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
  Object.assign(caseDoc, req.body);
  addTimelineEntry(caseDoc, req.user, req.body.timelineAction || 'Case updated', req.body.timelineNote || '');
  const labDone = caseDoc.labStatus === 'done' || caseDoc.labStatus === 'not_required';
  const pharmDone = caseDoc.pharmacyStatus === 'done' || caseDoc.pharmacyStatus === 'not_required';
  if (caseDoc.billingPaid && labDone && pharmDone) caseDoc.status = 'closed';
  await caseDoc.save();
  const io = req.app.get('io');
  io.emit('case:updated', caseDoc);
  res.json(caseDoc);
});

app.get('/api/cases/:id/timeline', auth(), async (req, res) => {
  const caseDoc = await Case.findById(req.params.id).select('timeline');
  if (!caseDoc) return res.status(404).json({ message: 'Case not found' });
  res.json(caseDoc.timeline || []);
});

// ======================= APPOINTMENTS =======================
app.get('/api/appointments', auth(), async (req, res) => {
  const { doctorId, day } = req.query;
  const query = {};
  if (req.user.role === 'doctor') query.doctorId = req.user.id;
  if (doctorId) query.doctorId = doctorId;
  if (day) query.date = day;
  const items = await Appointment.find(query).sort({ date: 1, time: 1 });
  res.json(items);
});

// ======================= BILLS =======================
app.post('/api/bills', auth(['receptionist', 'counter', 'admin', 'doctor']), async (req, res) => {
  const billData = req.body;
  const caseDoc = await Case.findById(billData.caseId);
  if (!caseDoc) return res.status(404).json({ message: 'Case not found' });
  let bill;
  if (billData.services && billData.billType) {
    bill = new Bill({
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
  } else {
    const { caseId, doctorFee = 0, medicines, labTests, extraLabCharges, extraPharmacyCharges, token } = req.body;
    const finalDoctorFee = Number(doctorFee) > 0 ? Number(doctorFee) : 0;
    const subtotal = finalDoctorFee +
      (medicines?.reduce((sum, m) => sum + (m.price * (m.quantity || 1)), 0) || 0) +
      (labTests?.reduce((sum, t) => sum + t.price, 0) || 0);
    const total = subtotal + (extraLabCharges || 0) + (extraPharmacyCharges || 0);
    bill = new Bill({
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
  }
  await bill.save();
  const io = req.app.get('io');
  io.emit('bill:created', bill);
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

// ======================= PATIENT REPORTS =======================
app.get('/api/patient-reports', auth(['doctor', 'admin']), async (req, res) => {
  const { phone, cnic, patientId } = req.query;
  const query = {};
  if (phone) query.phone = phone;
  else if (cnic) query.cnic = cnic;
  else if (patientId) query.patientId = patientId;
  else return res.status(400).json({ message: 'Provide phone, CNIC, or patientId' });
  const reports = await PatientReport.find(query).sort({ reportDate: -1 });
  res.json(reports);
});

app.post('/api/patient-reports', auth(['doctor']), async (req, res) => {
  const reportData = req.body;
  if (reportData.doctorId !== req.user.id) return res.status(403).json({ message: 'Doctor ID mismatch' });
  const report = new PatientReport(reportData);
  await report.save();
  const io = req.app.get('io');
  io.emit('patient-report:created', report);
  res.status(201).json(report);
});

app.get('/api/patient-reports/:id', auth(['doctor', 'admin']), async (req, res) => {
  const report = await PatientReport.findById(req.params.id);
  if (!report) return res.status(404).json({ message: 'Report not found' });
  res.json(report);
});

// ======================= PATIENT EHR MANAGEMENT =======================

// Get full patient record (with all EHR fields)
app.get('/api/patients/:id', auth(['doctor', 'admin', 'receptionist']), async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid patient ID' });
  const patient = await Patient.findById(id);
  if (!patient) return res.status(404).json({ message: 'Patient not found' });
  res.json(patient);
});

// Update patient (any field)
app.put('/api/patients/:id', auth(['doctor', 'admin']), async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid patient ID' });
  const patient = await Patient.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
  if (!patient) return res.status(404).json({ message: 'Patient not found' });
  res.json(patient);
});

// Allergies
app.post('/api/patients/:id/allergies', auth(['doctor', 'admin']), async (req, res) => {
  const { id } = req.params;
  const { allergy } = req.body;
  if (!allergy) return res.status(400).json({ message: 'Allergy text required' });
  const patient = await Patient.findByIdAndUpdate(
    id,
    { $addToSet: { allergies: allergy } },
    { new: true }
  );
  if (!patient) return res.status(404).json({ message: 'Patient not found' });
  res.json(patient.allergies);
});

app.delete('/api/patients/:id/allergies', auth(['doctor', 'admin']), async (req, res) => {
  const { id } = req.params;
  const { allergy } = req.body;
  if (!allergy) return res.status(400).json({ message: 'Allergy text required' });
  const patient = await Patient.findByIdAndUpdate(
    id,
    { $pull: { allergies: allergy } },
    { new: true }
  );
  if (!patient) return res.status(404).json({ message: 'Patient not found' });
  res.json(patient.allergies);
});

// Problem List
app.post('/api/patients/:id/problems', auth(['doctor', 'admin']), async (req, res) => {
  const { id } = req.params;
  const { problem, diagnosedDate, status, notes } = req.body;
  if (!problem) return res.status(400).json({ message: 'Problem text required' });
  const patient = await Patient.findByIdAndUpdate(
    id,
    { $push: { problemList: { problem, diagnosedDate: diagnosedDate || new Date(), status: status || 'active', notes } } },
    { new: true }
  );
  if (!patient) return res.status(404).json({ message: 'Patient not found' });
  res.json(patient.problemList);
});

app.put('/api/patients/:id/problems/:problemId', auth(['doctor', 'admin']), async (req, res) => {
  const { id, problemId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(problemId)) return res.status(400).json({ message: 'Invalid problem ID' });
  const patient = await Patient.findById(id);
  if (!patient) return res.status(404).json({ message: 'Patient not found' });
  const problemIndex = patient.problemList.findIndex(p => p._id.toString() === problemId);
  if (problemIndex === -1) return res.status(404).json({ message: 'Problem not found' });
  Object.assign(patient.problemList[problemIndex], req.body);
  await patient.save();
  res.json(patient.problemList);
});

app.delete('/api/patients/:id/problems/:problemId', auth(['doctor', 'admin']), async (req, res) => {
  const { id, problemId } = req.params;
  const patient = await Patient.findByIdAndUpdate(
    id,
    { $pull: { problemList: { _id: problemId } } },
    { new: true }
  );
  if (!patient) return res.status(404).json({ message: 'Patient not found' });
  res.json(patient.problemList);
});

// Immunizations
app.post('/api/patients/:id/immunizations', auth(['doctor', 'admin']), async (req, res) => {
  const { id } = req.params;
  const { name, date, provider, nextDue, lotNumber } = req.body;
  if (!name || !date) return res.status(400).json({ message: 'Name and date required' });
  const patient = await Patient.findByIdAndUpdate(
    id,
    { $push: { immunizations: { name, date: new Date(date), provider, nextDue: nextDue ? new Date(nextDue) : null, lotNumber } } },
    { new: true }
  );
  if (!patient) return res.status(404).json({ message: 'Patient not found' });
  res.json(patient.immunizations);
});

app.put('/api/patients/:id/immunizations/:immId', auth(['doctor', 'admin']), async (req, res) => {
  const { id, immId } = req.params;
  const patient = await Patient.findById(id);
  if (!patient) return res.status(404).json({ message: 'Patient not found' });
  const immIndex = patient.immunizations.findIndex(i => i._id.toString() === immId);
  if (immIndex === -1) return res.status(404).json({ message: 'Immunization not found' });
  Object.assign(patient.immunizations[immIndex], req.body);
  if (req.body.date) patient.immunizations[immIndex].date = new Date(req.body.date);
  if (req.body.nextDue) patient.immunizations[immIndex].nextDue = new Date(req.body.nextDue);
  await patient.save();
  res.json(patient.immunizations);
});

app.delete('/api/patients/:id/immunizations/:immId', auth(['doctor', 'admin']), async (req, res) => {
  const { id, immId } = req.params;
  const patient = await Patient.findByIdAndUpdate(
    id,
    { $pull: { immunizations: { _id: immId } } },
    { new: true }
  );
  if (!patient) return res.status(404).json({ message: 'Patient not found' });
  res.json(patient.immunizations);
});

// Vitals
app.post('/api/patients/:id/vitals', auth(['doctor', 'admin']), async (req, res) => {
  const { id } = req.params;
  const { bpSystolic, bpDiastolic, pulse, temperature, weight, height, notes } = req.body;
  let bmi = null;
  if (weight && height && height > 0) {
    bmi = weight / ((height / 100) ** 2);
  }
  const patient = await Patient.findByIdAndUpdate(
    id,
    { $push: { vitals: { date: new Date(), bpSystolic, bpDiastolic, pulse, temperature, weight, height, bmi, notes } } },
    { new: true }
  );
  if (!patient) return res.status(404).json({ message: 'Patient not found' });
  res.json(patient.vitals);
});

app.delete('/api/patients/:id/vitals/:vitalId', auth(['doctor', 'admin']), async (req, res) => {
  const { id, vitalId } = req.params;
  const patient = await Patient.findByIdAndUpdate(
    id,
    { $pull: { vitals: { _id: vitalId } } },
    { new: true }
  );
  if (!patient) return res.status(404).json({ message: 'Patient not found' });
  res.json(patient.vitals);
});

// Clinical Notes (SOAP)
app.post('/api/patients/:id/notes', auth(['doctor', 'admin']), async (req, res) => {
  const { id } = req.params;
  const { type, subjective, objective, assessment, plan } = req.body;
  if (!subjective && !objective && !assessment && !plan) {
    return res.status(400).json({ message: 'At least one field is required' });
  }
  const patient = await Patient.findByIdAndUpdate(
    id,
    { $push: { clinicalNotes: { date: new Date(), type: type || 'SOAP', subjective, objective, assessment, plan, doctorId: req.user.id, doctorName: req.user.name } } },
    { new: true }
  );
  if (!patient) return res.status(404).json({ message: 'Patient not found' });
  res.json(patient.clinicalNotes);
});

app.put('/api/patients/:id/notes/:noteId', auth(['doctor', 'admin']), async (req, res) => {
  const { id, noteId } = req.params;
  const patient = await Patient.findById(id);
  if (!patient) return res.status(404).json({ message: 'Patient not found' });
  const noteIndex = patient.clinicalNotes.findIndex(n => n._id.toString() === noteId);
  if (noteIndex === -1) return res.status(404).json({ message: 'Note not found' });
  Object.assign(patient.clinicalNotes[noteIndex], req.body);
  await patient.save();
  res.json(patient.clinicalNotes);
});

app.delete('/api/patients/:id/notes/:noteId', auth(['doctor', 'admin']), async (req, res) => {
  const { id, noteId } = req.params;
  const patient = await Patient.findByIdAndUpdate(
    id,
    { $pull: { clinicalNotes: { _id: noteId } } },
    { new: true }
  );
  if (!patient) return res.status(404).json({ message: 'Patient not found' });
  res.json(patient.clinicalNotes);
});

// ======================= PATIENT HISTORY & SEARCH =======================
app.get('/api/patients/:patientId/history', auth(['doctor', 'admin', 'receptionist']), async (req, res) => {
  const { patientId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(patientId)) return res.status(400).json({ message: 'Invalid patient ID' });
  const patient = await Patient.findById(patientId);
  if (!patient) return res.status(404).json({ message: 'Patient not found' });
  const cases = await Case.find({ patientId }).sort({ createdAt: -1 });
  res.json({ patient, cases });
});

app.get('/api/patients/search', auth(['receptionist', 'doctor', 'admin']), async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ message: 'Search query required' });
  const patients = await Patient.find({
    $or: [
      { name: { $regex: q, $options: 'i' } },
      { phone: { $regex: q, $options: 'i' } },
      { cnic: { $regex: q, $options: 'i' } },
    ]
  }).limit(20);
  res.json(patients);
});

// ======================= MIGRATION =======================
app.post('/api/migrate/backfill-patient-id', auth(['admin']), async (req, res) => {
  try {
    const cases = await Case.find({ patientId: { $exists: false } });
    let updated = 0;
    for (const c of cases) {
      let patient = await Patient.findOne({ phone: c.phone });
      if (!patient) {
        patient = new Patient({
          name: c.patientName,
          age: c.age,
          phone: c.phone,
          cnic: c.cnic || '',
        });
        await patient.save();
      }
      c.patientId = patient._id;
      await c.save();
      updated++;
    }
    res.json({ message: `✅ Updated ${updated} cases with patientId` });
  } catch (err) {
    console.error('Migration error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ======================= START SERVER =======================
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});