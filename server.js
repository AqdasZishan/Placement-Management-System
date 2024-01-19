const express = require('express');
const mysql = require('mysql2');
const mongoose = require('mongoose');
const app = express();

const multer = require('multer'); // Added multer for file uploads
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.static('public'));

const session = require('express-session');

// Add this middleware before your routes
app.use(
  session({
    secret: 'your-secret-key', // Change this to a secure secret
    resave: false,
    saveUninitialized: true,
  })
);

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '123456',
  database: 'project'
});

app.post('/authenticate', (req, res) => {
  const { sysid, password } = req.body;

  db.query('SELECT * FROM credentials WHERE SysId = ? AND Pass = ?', [sysid, password], async (err, results) => {
    if (err) {
      console.error('Database error:', err);
      res.status(500).json({ success: false, message: 'An error occurred while authenticating.' });
      return;
    }

    if (results.length === 1) {
      const userType = results[0].UserType;

      if (userType === 'student') {
        const userType = results[0].UserType;
        const name = results[0].Name;
        req.session.currentUserId = sysid;
        req.session.currentStudent = name;
        res.json({ success: true, userType: 'student', message: 'Student authentication successful.' });
      }
      else if (userType === 'admin') {
        res.json({ success: true, userType: 'admin', message: 'Admin authentication successful.' });
      }
      else {
        res.json({ success: false, message: 'Unknown user type.' });
      }
    }
    else {
      res.json({ success: false, message: 'Invalid username or password.' });
      console.log("error");
    }
  });
});

app.get('/student_dashboard', (req, res) => {
  // Render the student dashboard and pass the student's name
  res.status(200).json({ studentName: req.session.currentStudent });
});

mongoose.connect('mongodb://localhost:27017/project', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Could not connect to MongoDB...', err));

const studentSchema = new mongoose.Schema({
  SysId: String,
  Name: String,
  Branch: String,
  Section: String,
  //Email: String,
  // Add other details as per your requirements
});

const Student = mongoose.model('studentdetails', studentSchema);

//Profile of logged-in student
app.get('/profile', async (req, res) => {
  // Get the sysid from the session or cookie
  console.log(req.session.currentUserId);
  console.log(req.session.currentStudent);

  // Fetch the details of the logged-in student
  const student = await Student.findOne({ SysId: req.session.currentUserId}, { _id: 0 });
  
  if (student) {
    // Set the student's name in the session
    res.json(student);
  }
  else {
    // Handle the case where the student is not found
    res.status(404).json({ success: false, message: 'Student not found.' });
  }
});

// Define a Mongoose schema for placement drives
const placementSchema = new mongoose.Schema({
  name: String,
  description: String,
  startDate: Date,
  endDate: Date,
  status: String, // Ongoing, Upcoming, Recently Ended
  applications: [{ studentId: String, status: String, resume: String,}], // Track student applications
  performanceData: [{ studentId: String, performance: Number }], // Store performance data
});

const Placement = mongoose.model('Placement', placementSchema);

// Define MongoDB schema for student performance data
const performanceSchema = new mongoose.Schema({
  studentId: String,
  placementId: String,
  performance: Number,
});

const Performance = mongoose.model('Performance', performanceSchema);

//search a student for admin
app.get('/api/student/:sysid', async (req, res) => {
  const sysid = req.params.sysid;

  try {
    const student = await Student.findOne({ SysId: sysid }, { _id: 0 });

    if (student) {
      res.json(student);
    } else {
      res.status(404).json({ success: false, message: 'Student not found.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// GET route to fetch all placement drives for admin portal
app.get('/api/drives', async (req, res) => {
  const drives = await Placement.find();
  res.json(drives);
});

// POST route to create a new placement drive for admin portal
app.post('/api/drives', async (req, res) => {
  const drive = new Placement(req.body);
  await drive.save();
  res.json({ success: true });
});

// Delete a placement drive for admin portal
app.delete('/api/drives/:id', async (req, res) => {
  const driveId = req.params.id;
  try {
      const drive = await Placement.findById(driveId);
      if (!drive) {
          return res.status(404).json({ success: false, message: 'Drive not found' });
      }
      await Placement.deleteOne({ _id: driveId });
      res.json({ success: true, message: 'Drive deleted successfully' });
  } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

const schedule = require('node-schedule');

// Schedule a job to run daily at a specific time, you can adjust the time as needed.
const endJob = schedule.scheduleJob('0 0 * * *', async function() {
  try {
      const today = new Date();
      // Find placement drives where the end date is before today and the status is not "Ended".
      const drivesToUpdate = await Placement.find({
          endDate: { $lt: today },
          status: { $ne: 'Ended' },
      });

      // Update the status of the drives to "Ended".
      for (const drive of drivesToUpdate) {
          drive.status = 'Ended'; // Set the status to "Ended"
          try {
              await drive.save();
          } catch (error) {
              console.error('Error saving drive:', error);
          }
      }

      console.log('Updated placement drive statuses to "Ended"');
  } catch (error) {
      console.error('Error updating placement drive statuses:', error);
  }
});

// Schedule a job to run daily at a specific time to mark drives as "Active"
const startJob = schedule.scheduleJob('0 0 * * *', async function() {
  try {
    const today = new Date();

    // Find upcoming drives that have a start date in the past
    const upcomingDrives = await Placement.find({
      startDate: { $lt: today },
      status: 'Upcoming',
    });

    for (const drive of upcomingDrives) {
      drive.status = 'Active'; // Set the status to "Active"
      try {
        await drive.save();
      } catch (error) {
        console.error('Error saving drive:', error);
      }
    }

    console.log('Updated placement drive statuses to "Active"');
  } catch (error) {
    console.error('Error updating placement drive statuses:', error);
  }
});


// Add this route to get placement drives from MongoDB for student
app.get('/api/upcoming-placement-drives', async (req, res) => {
  try {
    const placementDrives = await Placement.find({status: 'Upcoming'});
    res.json(placementDrives);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Add these routes to get active placement drives for student
app.get('/api/active-placement-drives', async (req, res) => {
  try {
    const activeDrives = await Placement.find({ status: 'Active' });
    res.json(activeDrives);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Add these routes to get ended placement drives for student
app.get('/api/ended-placement-drives', async (req, res) => {
  try {
    const endedDrives = await Placement.find({ status: 'Ended' });
    res.json(endedDrives);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Apply for a placement
app.post('/api/apply-for-placement/:placementId', async (req, res) => {
  const { studentId } = req.body;
  const placementId = req.params.placementId;

  try {
    const placement = await Placement.findById(placementId);

    if (!placement) {
      return res.status(404).json({ message: 'Placement not found' });
    }

    // Check if the placement is upcoming
    if (placement.status !== 'Upcoming') {
      return res.status(400).json({ message: 'Cannot apply for a non-upcoming placement' });
    }

    // Check if the student has already applied
    const existingApplication = placement.applications.find((app) => app.studentId === studentId);

    if (existingApplication) {
      return res.status(400).json({ message: 'You have already applied for this placement' });
    }

    // Add the application
    placement.applications.push({ studentId, status: 'Applied' });

    await placement.save();
    res.json({ message: 'Application submitted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Submit student performance data
app.post('/api/submit-performance', async (req, res) => {
  const { studentId, placementId, performance } = req.body;

  try {
    const performanceRecord = new Performance({ studentId, placementId, performance });
    await performanceRecord.save();
    res.json({ message: 'Performance data submitted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Handle resume file uploads
app.post('/api/upload-resume/:placementId', upload.single('resume'), async (req, res) => {
  const studentId = req.body.studentId;
  const placementId = req.params.placementId;

  try {
    const placement = await Placement.findById(placementId);

    if (!placement) {
      return res.status(404).json({ message: 'Placement not found' });
    }

    // Check if the student has already applied
    const existingApplication = placement.applications.find((app) => app.studentId === studentId);

    if (existingApplication) {
      return res.status(400).json({ message: 'You have already applied for this placement' });
    }

    // Store the uploaded resume file path in the placement schema
    if (req.file) {
      const resumeFilePath = req.file.path; // Use the path to the uploaded file
      placement.applications.push({
        studentId,
        status: 'Applied',
        resume: resumeFilePath,
      });

      await placement.save();
      res.json({ success: true, message: 'Resume uploaded and application submitted successfully' });
    } else {
      res.status(400).json({ message: 'No resume file uploaded' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Add this route to get all student data
app.get('/api/students', async (req, res) => {
  try {
    const students = await Student.find({}, { _id: 0 });
    res.json({ success: true, students });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// GET route to fetch all placement drives for admin portal
app.get('/all_drives', (req, res) => {
  res.sendFile(__dirname + '/path/to/all_drives.html');
});

// Add this route to get students for a specific placement drive
app.get('/api/drives/:placementId/students', async (req, res) => {
  const placementId = req.params.placementId;

  try {
    const placement = await Placement.findById(placementId);

    if (!placement) {
      res.status(404).json({ success: false, message: 'Placement not found.' });
    } else {
      const students = placement.applications.map(async (application) => {
        const studentInfo = await Student.findOne({ SysId: application.studentId }, { _id: 0, Name: 1 });
        const studentName = studentInfo ? studentInfo.Name : 'Unknown';
      
        return {
          studentId: application.studentId,
          studentName: studentName,
        };
      });
      
      // Wait for all the asynchronous operations to complete
      const studentDetails = await Promise.all(students);
      
      res.json({ success: true, students: studentDetails });
      
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});


// Add a single route for logout
app.get('/logout', (req, res) => {
  // Destroy the user's session to log them out (works for both students and admins)
  req.session.destroy(err => {
      if (err) {
          console.error('Error destroying session:', err);
          res.status(500).json({ success: false, message: 'Logout failed.' });
      } else {
          res.json({ success: true, message: 'Logout successful.' });
      }
  });
});

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
