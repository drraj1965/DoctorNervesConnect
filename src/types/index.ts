
import type { User as FirebaseUser } from 'firebase/auth';

export interface UserProfile extends FirebaseUser {
  role?: 'patient' | 'doctor';
  // Consider adding other common user fields if they exist in 'users' collection
  // and are distinct from FirebaseUser default fields.
}

export interface DoctorProfile extends UserProfile {
  specialization?: string;
  firstName?: string; 
  lastName?: string;
  username?: string;
  doctor_email?: string; 
  doctor_mobile?: string;
  isAdmin?: boolean; 
}

export interface VideoComment {
  id: string; 
  userId: string;
  userName: string;
  userPhotoUrl?: string; 
  text: string;
  createdAt: string; // ISO date string
  parentId?: string | null; 
  replies?: VideoComment[]; 
}

export interface VideoMeta {
  id: string; // UUID v4
  title: string;
  description: string;
  doctorId: string; // Firebase UID of the doctor
  doctorName: string;
  videoUrl: string; // Download URL from Firebase Storage
  thumbnailUrl: string; // Download URL from Firebase Storage
  duration: string; // Formatted string e.g., "02:59"
  recordingDuration?: number; // Actual duration in seconds, as a number
  tags: string[];
  createdAt: string; // ISO date string (serverTimestamp on write, string on read)
  viewCount: number;
  likeCount: number; // Not implemented yet, but good for future
  commentCount: number;
  featured: boolean; // To show in "Recent Activities"
  permalink: string; // e.g., /videos/{id}
  storagePath: string; // Full path in Firebase Storage for the video file
  thumbnailStoragePath: string; // Full path in Firebase Storage for the thumbnail
  videoSize?: number; // File size in bytes
  videoType?: string; // Mime type e.g., "video/mp4", "video/webm"
  comments?: VideoComment[];
}


export interface Article {
  id: string;
  title: string;
  content: string; 
  doctorId: string;
  doctorName: string;
  tags: string[];
  createdAt: string; // ISO date string
  updatedAt?: string; // ISO date string
  isPublished: boolean;
}

export interface Question {
  id: string;
  patientId: string;
  patientName: string; 
  doctorId: string; 
  questionText: string;
  answerText?: string;
  isAnswered: boolean;
  createdAt: string; // ISO date string
  answeredAt?: string; // ISO date string
}

