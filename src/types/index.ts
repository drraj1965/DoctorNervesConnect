
import type { User as FirebaseUser } from 'firebase/auth';

export interface UserProfile extends FirebaseUser {
  role?: 'patient' | 'doctor';
  // Consider adding other common user fields if they exist in 'users' collection
  // and are distinct from FirebaseUser default fields.
}

export interface DoctorProfile extends UserProfile {
  specialization?: string;
  firstName?: string; // From your logs, these exist
  lastName?: string;
  username?: string;
  doctor_email?: string; // Match field names from logs if different from UserProfile.email
  doctor_mobile?: string;
  isAdmin?: boolean; // This is crucial
}

export interface VideoComment {
  id: string; // Unique ID for the comment
  userId: string;
  userName: string;
  userPhotoUrl?: string; // Optional: for displaying avatar
  text: string;
  createdAt: string; // ISO date string
  parentId?: string | null; // For threading/replies
  replies?: VideoComment[]; // For nested display, though direct array update in Firestore is hard
}

export interface VideoMeta {
  id: string;
  title: string;
  description: string;
  doctorId: string;
  doctorName: string;
  videoUrl: string;
  thumbnailUrl: string;
  duration: string; // Formatted string e.g., "01:23"
  recordingDuration?: number; // Actual duration in seconds, as a number
  tags: string[];
  createdAt: string; // ISO date string (or Firestore Timestamp on server, converted to string for client)
  viewCount: number;
  // likeCount and commentCount are good to have for consistency, required by rules
  likeCount: number;
  commentCount: number;
  featured: boolean;
  permalink: string;
  storagePath: string; // Full path in Firebase Storage for the video file
  thumbnailStoragePath: string; // Full path in Firebase Storage for the thumbnail
  videoSize?: number; // File size in bytes
  videoType?: string; // Mime type e.g., "video/webm"
  comments?: VideoComment[];
}

// This type represents the data structure the VideoRecorder client will prepare and send
// for creating a new video's metadata. It omits fields that are purely server-set.
export type VideoDataForCreation = Omit<VideoMeta, 'createdAt' | 'permalink' | 'viewCount' | 'likeCount' | 'commentCount' | 'comments'>;


export interface Article {
  id: string;
  title: string;
  content: string; // Or a more structured format like Delta for rich text
  doctorId: string;
  doctorName: string;
  tags: string[];
  createdAt: string; // ISO date string
  updatedAt?: string; // ISO date string
  isPublished: boolean;
  // Add other fields like excerpt, featuredImage, etc.
}

export interface Question {
  id: string;
  patientId: string;
  patientName: string; // Consider denormalizing for display
  doctorId: string; // ID of the doctor it's assigned to, or null if open
  questionText: string;
  answerText?: string;
  isAnswered: boolean;
  createdAt: string; // ISO date string
  answeredAt?: string; // ISO date string
  // Add other fields like category, attachments, etc.
}
